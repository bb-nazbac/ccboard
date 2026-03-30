import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";

const COLORS = {
  folder: "#00aa2a",
  file: "#335588",
  read: "#00cccc",
  edit: "#ffb000",
  active: "#00ffff",
  edge: "#1a2a1a",
};

// Build a graphology graph from a flat file list
function buildFileGraph(files) {
  const graph = new Graph();
  const folders = new Set();

  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  }

  for (const folder of folders) {
    graph.addNode(folder, {
      label: folder.split("/").pop(),
      size: 6,
      color: COLORS.folder,
      nodeKind: "folder",
      x: (Math.random() - 0.5) * 100,
      y: (Math.random() - 0.5) * 100,
      heat: 0,
    });
  }

  for (const f of files) {
    graph.addNode(f, {
      label: f.split("/").pop(),
      size: 3,
      color: COLORS.file,
      nodeKind: "file",
      x: (Math.random() - 0.5) * 100,
      y: (Math.random() - 0.5) * 100,
      heat: 0,
    });
  }

  for (const folder of folders) {
    const parent = folder.split("/").slice(0, -1).join("/");
    if (parent && graph.hasNode(parent)) {
      try { graph.addEdge(parent, folder, { color: COLORS.edge, size: 0.5 }); } catch {}
    }
  }

  for (const f of files) {
    const parent = f.split("/").slice(0, -1).join("/");
    if (parent && graph.hasNode(parent)) {
      try { graph.addEdge(parent, f, { color: COLORS.edge, size: 0.3 }); } catch {}
    }
  }

  forceAtlas2.assign(graph, {
    iterations: 100,
    settings: { gravity: 1, scalingRatio: 2, barnesHutOptimize: true, strongGravityMode: true },
  });

  noverlap.assign(graph, { maxIterations: 50, ratio: 1.5 });

  return graph;
}

// Initialize Sigma renderer on a container element
function initSigma(container, graph) {
  return new Sigma(graph, container, {
    renderLabels: true,
    labelFont: "Share Tech Mono, Courier New, monospace",
    labelSize: 10,
    labelColor: { color: "#666" },
    labelRenderedSizeThreshold: 4,
    labelDensity: 0.3,
    labelGridCellSize: 80,
    defaultNodeColor: "#1a1a1a",
    defaultEdgeColor: COLORS.edge,
    defaultEdgeType: "line",
    minCameraRatio: 0.05,
    maxCameraRatio: 10,
    hideEdgesOnMove: false,
    zIndex: true,
    nodeReducer(node, data) {
      return {
        ...data,
        color: data.heat > 0
          ? (data.heat > 0.8 ? COLORS.active : (data.lastAction === "edit" || data.lastAction === "write" ? COLORS.edit : COLORS.read))
          : data.color,
      };
    },
  });
}

// Apply agent activity — only last 20 file-touching actions glow
// ALL actions passed in (not just new ones) — we recalculate from scratch
// cwd is the project root, used to strip absolute paths to relative
function applyActivity(graph, allActions, cwd) {
  // Reset all nodes to dark
  graph.forEachNode((node, attrs) => {
    graph.setNodeAttribute(node, "heat", 0);
    graph.setNodeAttribute(node, "lastAction", null);
    graph.setNodeAttribute(node, "size", attrs.nodeKind === "folder" ? 6 : 3);
  });

  // Filter to file-touching actions only
  const fileActions = allActions.filter(
    (a) => a.type === "tool_use" && a.filePath && a.tool !== "Bash"
  );

  // Take last 20
  const recent = fileActions.slice(-20);
  if (recent.length === 0) return;

  // Resolve each action to a graph node
  // Build cwd prefix for stripping absolute paths
  const cwdPrefix = cwd ? (cwd.endsWith("/") ? cwd : cwd + "/") : "";

  for (let i = 0; i < recent.length; i++) {
    const action = recent[i];
    let filePath = action.filePath;

    // Strip absolute cwd prefix to get relative path matching git ls-files
    if (cwdPrefix && filePath.startsWith(cwdPrefix)) {
      filePath = filePath.slice(cwdPrefix.length);
    }

    let target = null;

    if (graph.hasNode(filePath)) {
      target = filePath;
    } else {
      // Try with ./ prefix
      if (graph.hasNode("./" + filePath)) {
        target = "./" + filePath;
      } else {
        // Fuzzy match by basename
        const basename = filePath.split("/").pop();
        graph.forEachNode((node) => {
          if (!target && (node.endsWith("/" + basename) || node === basename)) {
            target = node;
          }
        });
      }
    }

    if (!target) continue;

    // Recency: 0 = oldest of the 20, 19 = most recent → heat 0.2 to 1.0
    const recency = (i + 1) / recent.length; // 0.05 to 1.0
    const heat = 0.15 + recency * 0.85; // 0.15 to 1.0

    // Keep the highest heat if a file was touched multiple times
    const currentHeat = graph.getNodeAttribute(target, "heat") || 0;
    if (heat > currentHeat) {
      graph.setNodeAttribute(target, "heat", heat);
      graph.setNodeAttribute(target, "lastAction", (action.tool || "read").toLowerCase());
      graph.setNodeAttribute(target, "size", graph.getNodeAttribute(target, "nodeKind") === "folder" ? 8 : 5);
    }

    // Light up parent folder dimly
    const parent = target.split("/").slice(0, -1).join("/");
    if (parent && graph.hasNode(parent)) {
      const parentHeat = graph.getNodeAttribute(parent, "heat") || 0;
      graph.setNodeAttribute(parent, "heat", Math.max(parentHeat, heat * 0.4));
    }
  }
}

// Expose to global scope so inline scripts can use them
window.FileGraph = { buildFileGraph, initSigma, applyActivity };
