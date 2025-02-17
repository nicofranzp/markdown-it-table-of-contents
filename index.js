//@ts-check
'use strict';

/*
* markdown-it-table-of-contents
*
* The algorithm works as follows:
* Step 1: Gather all headline tokens from a Markdown document and put them in an array.
* Step 2: Turn the flat array into a nested tree, respecting the correct headline level.
* Step 3: Turn the nested tree into HTML code.
*/

const slugify = function (s) {
  return encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, '-'));
};
const defaults = {
  includeLevel: [1, 2],
  containerClass: 'table-of-contents',
  slugify: slugify,
  markerPattern: /^\[\[toc\]\]/im,
  listType: 'ul',
  format: function (content, md) {
    return md.renderInline(content);
  },
  forceFullToc: false,
  containerHeaderHtml: undefined,
  containerFooterHtml: undefined,
  transformLink: undefined,
  listAttrs: '',
};

/**
* @typedef {Object} HeadlineItem
* @property {number} level Headline level
* @property {string} anchor Anchor target
* @property {string} text Text of headline
*/

/**
* @typedef {Object} TocItem
* @property {number} level Item level
* @property {string} text Text of link
* @property {string} anchor Target of link
* @property {Array<TocItem>} children Sub-items for this list item
* @property {TocItem} parent Parent this item belongs to
*/

/**
* Finds all headline items for the defined levels in a Markdown document.
* @param {Array<number>} levels includeLevels like `[1, 2, 3]`
* @param {*} tokens Tokens gathered by the plugin
* @param {*} options Plugin options
* @returns {Array<HeadlineItem>}
*/
function findHeadlineElements(levels, tokens, options) {
  const headings = [];
  let currentHeading = null;

  tokens.forEach(token => {
    if (token.type === 'heading_open') {
      const id = findExistingIdAttr(token);
      const level = parseInt(token.tag.toLowerCase().replace('h', ''), 10);
      if (levels.indexOf(level) >= 0) {
        currentHeading = {
          level: level,
          text: null,
          anchor: id || null
        };
      }
    }
    else if (currentHeading && token.type === 'inline') {
      const textContent = token.children
        .filter((childToken) => childToken.type === 'text' || childToken.type === 'code_inline')
        .reduce((acc, t) => acc + t.content, '');
      currentHeading.text = textContent;
      if (! currentHeading.anchor) {
        currentHeading.anchor = options.slugify(textContent, token.content);
      }
    }
    else if (token.type === 'heading_close') {
      if (currentHeading) {
        headings.push(currentHeading);
      }
      currentHeading = null;
    }
  });

  return headings;
}

/**
* Helper to find an existing id attr on a token. Should be a heading_open token, but could be anything really
* Provided by markdown-it-anchor or markdown-it-attrs
* @param {any} token Token
* @returns {string} Id attribute to use as anchor
*/
function findExistingIdAttr(token) {
  if (token && token.attrs && token.attrs.length > 0) {
    const idAttr = token.attrs.find( (attr) => {
      if (Array.isArray(attr) && attr.length >= 2) {
        return attr[0] === 'id';
      }
      return false;
    });
    if (idAttr && Array.isArray(idAttr) && idAttr.length >= 2) {
      const [key, val] = idAttr;
      return val;
    }
  }
  return null;
}

/**
* Helper to get minimum headline level so that the TOC is nested correctly
* @param {Array<HeadlineItem>} headlineItems Search these
* @returns {number} Minimum level
*/
function getMinLevel(headlineItems) {
  return Math.min(...headlineItems.map(item => item.level));
}

/**
* Helper that creates a TOCItem
* @param {number} level
* @param {string} text
* @param {string} anchor
* @param {TocItem} rootNode
* @returns {TocItem}
*/
function addListItem(level, text, anchor, rootNode) {
  const listItem = { level, text, anchor, children: [], parent: rootNode };
  rootNode.children.push(listItem);
  return listItem;
}

/**
* Turns a list of flat headline items into a nested tree object representing the TOC
* @param {Array<HeadlineItem>} headlineItems
* @returns {TocItem} Tree of TOC items
*/
function flatHeadlineItemsToNestedTree(headlineItems) {
  // create a root node with no text that holds the entire TOC. this won't be rendered, but only its children
  const toc = { level: getMinLevel(headlineItems) - 1, anchor: null, text: null, children: [], parent: null };
  // pointer that tracks the last root item of the current list
  let currentRootNode = toc;
  // pointer that tracks the last item (to turn it into a new root node if necessary)
  let prevListItem = currentRootNode;

  headlineItems.forEach(headlineItem => {
    // if level is bigger, take the previous node, add a child list, set current list to this new child list
    if (headlineItem.level > prevListItem.level) {
      // eslint-disable-next-line no-unused-vars
      Array.from({ length: headlineItem.level - prevListItem.level }).forEach(_ => {
        currentRootNode = prevListItem;
        prevListItem = addListItem(headlineItem.level, null, null, currentRootNode);
      });
      prevListItem.text = headlineItem.text;
      prevListItem.anchor = headlineItem.anchor;
    }
    // if level is same, add to the current list
    else if (headlineItem.level === prevListItem.level) {
      prevListItem = addListItem(headlineItem.level, headlineItem.text, headlineItem.anchor, currentRootNode);
    }
    // if level is smaller, set current list to currentlist.parent
    else if (headlineItem.level < prevListItem.level) {
      for (let i = 0; i < prevListItem.level - headlineItem.level; i++) {
        currentRootNode = currentRootNode.parent;
      }
      prevListItem = addListItem(headlineItem.level, headlineItem.text, headlineItem.anchor, currentRootNode);
    }
  });

  return toc;
}

/**
* Recursively turns a nested tree of tocItems to HTML.
* @param {TocItem} tocItem
* @returns {string}
*/
function tocItemToHtml(tocItem, options, md, counter = 0) {
  let extraAttributes = ''
  if (counter == 0){
    if (options.listAttrs !== '') { extraAttributes = ' ' + options.listAttrs }
  }
  return '<' + options.listType + extraAttributes + '>' + tocItem.children.map(childItem => {
    let li = '<li>';
    let anchor = childItem.anchor;
    if (options && options.transformLink) {
      anchor = options.transformLink(anchor);
    }

    let text = childItem.text ? options.format(childItem.text, md, anchor) : null;

    li += anchor ? `<a href="#${anchor}">${text}</a>` : (text || '');

    return li + (childItem.children.length > 0 ? tocItemToHtml(childItem, options, md, counter + 1) : '') + '</li>';
  }).join('') + '</' + options.listType + '>';
}

module.exports = function (md, o) {
  const options = Object.assign({}, defaults, o);
  const tocRegexp = options.markerPattern;
  let gstate;

  function toc(state, silent) {
    let token;
    let match;

    // Reject if the token does not start with [
    if (state.src.charCodeAt(state.pos) !== 0x5B /* [ */) {
      return false;
    }
    // Don't run any pairs in validation mode
    if (silent) {
      return false;
    }

    // Detect TOC markdown
    match = tocRegexp.exec(state.src.substr(state.pos));
    match = !match ? [] : match.filter(function (m) { return m; });
    if (match.length < 1) {
      return false;
    }

    // Build content
    token = state.push('toc_open', 'toc', 1);
    token.markup = '[[toc]]';
    token = state.push('toc_body', '', 0);
    token = state.push('toc_close', 'toc', -1);

    // Update pos so the parser can continue
    var newline = state.src.indexOf('\n', state.pos);
    if (newline !== -1) {
      state.pos = newline;
    } else {
      state.pos = state.pos + state.posMax + 1;
    }

    return true;
  }

  md.renderer.rules.toc_open = function (tokens, index) {
    var tocOpenHtml = '<div class="' + options.containerClass + '">';

    if (options.containerHeaderHtml) {
      tocOpenHtml += options.containerHeaderHtml;
    }

    return tocOpenHtml;
  };

  md.renderer.rules.toc_close = function (tokens, index) {
    var tocFooterHtml = '';

    if (options.containerFooterHtml) {
      tocFooterHtml = options.containerFooterHtml;
    }

    return tocFooterHtml + '</div>';
  };

  md.renderer.rules.toc_body = function (tokens, index) {
    if (options.forceFullToc) {
      throw ("forceFullToc was removed in version 0.5.0. For more information, see https://github.com/Oktavilla/markdown-it-table-of-contents/pull/41");
    } else {
      const headlineItems = findHeadlineElements(options.includeLevel, gstate.tokens, options);
      const toc = flatHeadlineItemsToNestedTree(headlineItems);
      const html = tocItemToHtml(toc, options, md);
      return html;
    }
  };

  // Catch all the tokens for iteration later
  md.core.ruler.push('grab_state', function (state) {
    gstate = state;
  });

  // Insert TOC
  md.inline.ruler.after('emphasis', 'toc', toc);
};
