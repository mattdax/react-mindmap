const path = require('path');
const fs = require('fs');
const walk = require('fs-walk').walk;

const { emojiToCategory, matchEmojis } = require('./emojis');
const { getText, getURL } = require('./html');


// These two arguments must be directories.
const input = process.argv[2];
const output = process.argv[3];

if (input === undefined || output === undefined) {
  console.log('No files were parsed due to insufficient arguments \nPlease run the parser with the following command: npm run parse "path/to/mindmap/json/folder" "path/to/output/folder"');
  process.exit();
}

/*
 * Recursively walk a directory and call a function on all its files.
 */
const walkDir = (dirname, fn) => {
  walk(dirname, (basedir, filename, stat) => {
    const absPath = path.resolve(path.join(__dirname, '/../..'), basedir, filename);

    if (stat.isDirectory()) {
      return walkDir(absPath, fn);
    }

    if (typeof fn === 'function') {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      fn(require(absPath), absPath);
    }

    return null;
  });
};

/*
 * Take a node from MindNode format and return it in the following format:
 *
 *  {
 *    text: string,
 *    url: string,
 *    note: string || undefined,
 *    fx: number,
 *    fy: number,
 *  }
 */
const parseNode = (node) => {
  // Match style attributed in an HTML string.
  const parsedNode = {
    text: getText(node.title.text),
    url: getURL(node.title.text),
    note: node.note ? getText(node.note.text) : undefined,
    fx: node.location.x,
    fy: node.location.y,
  };

  if (parsedNode.note) {
    parsedNode.note = parsedNode.note.replace('if you think this can be improved in any way  please say', '');
  }

  const match = parsedNode.text.match(matchEmojis);

  if (match) {
    parsedNode.category = emojiToCategory(match[0]);
    parsedNode.text = parsedNode.text.replace(matchEmojis, '').trim();
  }

  return parsedNode;
};

/*
 * Get all subnodes and flatten them, by putting them all at the same level,
 * and adding the parent attribute.
 */
const getSubnodesR = (subnodes, parent) => {
  const res = [];

  subnodes.forEach((subnode) => {
    res.push(Object.assign({ parent }, subnode));

    getSubnodesR(subnode.nodes, parseNode(subnode).text).forEach(sn => res.push(sn));
  });

  return res;
};

const getSubnodes = (nodes) => {
  const subnodes = [];

  nodes.forEach(node => (
    getSubnodesR(node.nodes, parseNode(node).text).forEach(subnode => subnodes.push(subnode))
  ));

  return subnodes;
};

/*
 * Similar structure as parseNode, with two additional attributes `parent` and `color`,
 * which respectively are the text of the parent node, and the color of the connection
 * from parent to subnode.
 */
const parseSubnode = (subnode) => {
  const parsedSubnode = parseNode(subnode);
  let color;

  if (subnode.shapeStyle && subnode.shapeStyle.borderStrokeStyle) {
    color = subnode.shapeStyle.borderStrokeStyle.color;
  }

  parsedSubnode.color = color;
  parsedSubnode.parent = subnode.parent;

  return parsedSubnode;
};

/*
 * Take a connection from MindNode format and return it in the following format:
 *
 *  {
 *    text: string,
 *    source: string,
 *    target: string,
 *    curve: {
 *      x: number,
 *      y: number,
 *    },
 *  }
 *
 * source and target are the text attributes of the nodes the connection links.
 * curve is the location of the focal point for a bezier curve.
 */
const parseConn = (conn, lookup) => {
  const parsedConn = {
    source: lookup[conn.startNodeID],
    target: lookup[conn.endNodeID],
    curve: {
      x: conn.wayPointOffset.x,
      y: conn.wayPointOffset.y,
    },
  };

  if (conn.title && conn.title.text) {
    parsedConn.text = getText(conn.title.text);
  }

  return parsedConn;
};


walkDir(input, (map, filename) => {
  const nodesLookup = {};

  const parsedMap = { title: map.title };


  // Parse all nodes and populate the lookup table, which will be used for
  // converting IDs to a more human readable format on connections.
  parsedMap.nodes = map.nodes.map((node) => {
    const parsedNode = parseNode(node);
    nodesLookup[node.id] = parsedNode.text;
    return parsedNode;
  });

  parsedMap.subnodes = getSubnodes(map.nodes).map(subnode => parseSubnode(subnode));
  parsedMap.connections = map.connections.map(conn => parseConn(conn, nodesLookup));

  const inputBasePath = `${path.resolve(path.join(__dirname, '../../'), input)}/`;
  const outputFile = path.join(output, filename.replace(inputBasePath, ''));
  const outputPath = path.dirname(outputFile);

  // Create folder if it doesn't exist.
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath);
  }

  // Write parsed map to new location.
  fs.writeFile(outputFile, JSON.stringify(parsedMap, null, 2), (err) => {
    if (err) {
      throw err;
    }
  });
});
