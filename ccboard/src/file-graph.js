import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";

const COLORS = {
  folder: "#00aa2a",
  file: "#335588",
  // Dimmed versions for untouched nodes
  folderDim: "#1a2a1a",
  fileDim: "#181822",
  edgeDim: "#111111",
  // Active colors by action type
  read: { r: 0, g: 204, b: 204 },    // cyan
  edit: { r: 255, g: 176, b: 0 },     // amber
  write: { r: 255, g: 176, b: 0 },    // amber
  grep: { r: 0, g: 170, b: 42 },      // green
  glob: { r: 0, g: 170, b: 42 },      // green
  default: { r: 0, g: 204, b: 204 },  // cyan
  edge: "#1a2a1a",
};

// Interpolate a color from dim to bright based on heat (0 to 1)
function heatToColor(heat, actionType) {
  const base = COLORS[actionType] || COLORS.default;
  // At heat 0.15 (oldest of 20) → 15% brightness, at heat 1.0 → 100%
  const r = Math.round(base.r * heat);
  const g = Math.round(base.g * heat);
  const b = Math.round(base.b * heat);
  return `rgb(${r},${g},${b})`;
}

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
      size: 2,
      color: COLORS.folderDim,
      nodeKind: "folder",
      x: (Math.random() - 0.5) * 100,
      y: (Math.random() - 0.5) * 100,
      heat: 0,
    });
  }

  for (const f of files) {
    graph.addNode(f, {
      label: f.split("/").pop(),
      size: 1,
      color: COLORS.fileDim,
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
      if (data.heat > 0) {
        return {
          ...data,
          color: heatToColor(data.heat, data.lastAction),
          label: data.label,
          size: data.size,
        };
      }
      // Untouched — nearly invisible, no label
      return {
        ...data,
        color: data.nodeKind === "folder" ? COLORS.folderDim : COLORS.fileDim,
        label: null,
        size: data.nodeKind === "folder" ? 2 : 1,
      };
    },
    edgeReducer(edge, data) {
      // Only show path edges, dim everything else
      if (data.isPathEdge) {
        return { ...data, color: "#00cccc80", size: 1.5 };
      }
      return { ...data, color: COLORS.edgeDim, size: 0.15 };
    },
  });
}

// Store the agent's path and per-node action details globally
let agentPath = []; // ordered list of { node, action, index }
let nodeActions = {}; // node → [{ tool, timestamp, oldString, newString, index }]

function resolveNode(graph, filePath, cwdPrefix) {
  if (cwdPrefix && filePath.startsWith(cwdPrefix)) {
    filePath = filePath.slice(cwdPrefix.length);
  }
  if (graph.hasNode(filePath)) return filePath;
  if (graph.hasNode("./" + filePath)) return "./" + filePath;
  const basename = filePath.split("/").pop();
  let found = null;
  graph.forEachNode((node) => {
    if (!found && (node.endsWith("/" + basename) || node === basename)) found = node;
  });
  return found;
}

// Apply agent activity — builds path, heat, and per-node action log
function applyActivity(graph, allActions, cwd) {
  // Reset
  graph.forEachNode((node) => {
    graph.setNodeAttribute(node, "heat", 0);
    graph.setNodeAttribute(node, "lastAction", null);
    graph.setNodeAttribute(node, "size", graph.getNodeAttribute(node, "nodeKind") === "folder" ? 2 : 1);
  });

  // Remove old path edges
  graph.forEachEdge((edge, attrs) => {
    if (attrs.isPathEdge) graph.dropEdge(edge);
  });

  const cwdPrefix = cwd ? (cwd.endsWith("/") ? cwd : cwd + "/") : "";

  // Filter to file-touching actions
  const fileActions = allActions.filter(
    (a) => a.type === "tool_use" && a.filePath && a.tool !== "Bash"
  );
  const recent = fileActions.slice(-40);
  if (recent.length === 0) { agentPath = []; nodeActions = {}; return; }

  // Build path and per-node actions
  agentPath = [];
  nodeActions = {};

  for (let i = 0; i < recent.length; i++) {
    const action = recent[i];
    const target = resolveNode(graph, action.filePath, cwdPrefix);
    if (!target) continue;

    const entry = {
      node: target,
      tool: action.tool,
      timestamp: action.timestamp,
      oldString: action.oldString || null,
      newString: action.newString || null,
      index: i,
    };

    agentPath.push(entry);

    if (!nodeActions[target]) nodeActions[target] = [];
    nodeActions[target].push(entry);

    // Heat
    const recency = (i + 1) / recent.length;
    const heat = 0.15 + recency * 0.85;
    const currentHeat = graph.getNodeAttribute(target, "heat") || 0;
    if (heat > currentHeat) {
      graph.setNodeAttribute(target, "heat", heat);
      graph.setNodeAttribute(target, "lastAction", (action.tool || "read").toLowerCase());
      graph.setNodeAttribute(target, "size", graph.getNodeAttribute(target, "nodeKind") === "folder" ? 8 : 5);
    }

    // Parent glow
    const parent = target.split("/").slice(0, -1).join("/");
    if (parent && graph.hasNode(parent)) {
      graph.setNodeAttribute(parent, "heat", Math.max(
        graph.getNodeAttribute(parent, "heat") || 0, heat * 0.4
      ));
    }
  }

  // Draw path edges (dashed = type "dashed" isn't built in, use color to distinguish)
  let prevNode = null;
  for (const step of agentPath) {
    if (prevNode && prevNode !== step.node && graph.hasNode(prevNode) && graph.hasNode(step.node)) {
      const edgeId = `path-${prevNode}-${step.node}-${step.index}`;
      if (!graph.hasEdge(edgeId)) {
        try {
          graph.addEdgeWithKey(edgeId, prevNode, step.node, {
            color: "#00cccc80",
            size: 1.5,
            isPathEdge: true,
            zIndex: 10,
          });
        } catch {}
      }
    }
    prevNode = step.node;
  }
}

// Color for each action type
const TOOL_COLORS = {
  Read: { bg: "#0a1a1a", border: "#008888", text: "#00cccc", label: "READ" },
  Edit: { bg: "#1a1a0a", border: "#aa7500", text: "#ffb000", label: "EDIT" },
  Write: { bg: "#1a0a1a", border: "#8844aa", text: "#bb66dd", label: "WRITE" },
  Grep: { bg: "#0a1a0a", border: "#00aa2a", text: "#00ff41", label: "GREP" },
  Glob: { bg: "#0a1a0a", border: "#00aa2a", text: "#00ff41", label: "GLOB" },
};

function getToolStyle(tool) {
  return TOOL_COLORS[tool] || { bg: "#0d0d0d", border: "#333", text: "#666", label: tool };
}

// Setup click handler for node popups
function setupNodeClick(sigma, graph, container) {
  function showNodePopup(node) {
    const actions = nodeActions[node];
    if (!actions || actions.length === 0) return;

    // Remove existing
    const old = document.getElementById("node-popup-overlay");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "node-popup-overlay";
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 200;
      display: flex; justify-content: center; align-items: flex-start; padding: 40px 30px 30px;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
      background: #0a0a0a; border: 1px solid #222; width: 700px; max-width: 95vw;
      max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;
      font-family: 'Share Tech Mono', monospace; font-size: 12px; color: #888;
    `;

    const label = node.split("/").pop();
    let html = "";

    // Header
    html += `<div style="padding:12px 16px;border-bottom:1px solid #161616;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
      <div>
        <span style="color:#e0e0e0;font-size:14px;font-weight:500;">${esc(label)}</span>
        <span style="color:#333;font-size:10px;margin-left:8px;">${esc(node)}</span>
      </div>
      <span id="node-popup-close" style="cursor:pointer;color:#444;padding:4px 10px;border:1px solid #222;font-size:11px;">ESC</span>
    </div>`;

    // Legend
    html += `<div style="padding:8px 16px;border-bottom:1px solid #111;display:flex;gap:12px;flex-shrink:0;">
      <span style="font-size:9px;color:#333;letter-spacing:1px;">LEGEND:</span>
      <span style="font-size:9px;color:${TOOL_COLORS.Read.text};">● READ</span>
      <span style="font-size:9px;color:${TOOL_COLORS.Edit.text};">● EDIT</span>
      <span style="font-size:9px;color:${TOOL_COLORS.Write.text};">● WRITE</span>
      <span style="font-size:9px;color:${TOOL_COLORS.Grep.text};">● GREP</span>
    </div>`;

    // Agent path timeline — color-coded, shows ALL steps in order (not deduplicated)
    html += `<div style="padding:10px 16px;border-bottom:1px solid #111;flex-shrink:0;">
      <div style="font-size:9px;color:#333;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">AGENT PATH — ${agentPath.length} steps</div>
      <div style="display:flex;flex-wrap:wrap;gap:2px;max-height:80px;overflow-y:auto;">`;

    for (let pi = 0; pi < agentPath.length; pi++) {
      const step = agentPath[pi];
      const isThis = step.node === node;
      const name = step.node.split("/").pop();
      const ts = getToolStyle(step.tool);
      const bg = isThis ? ts.bg : "#0a0a0a";
      const color = isThis ? "#ffffff" : ts.text;
      const border = isThis ? `2px solid ${ts.border}` : `1px solid #1a1a1a`;
      const opacity = isThis ? "1" : "0.7";

      html += `<span class="timeline-node" data-node="${esc(step.node)}" style="
        padding:2px 6px;font-size:9px;color:${color};background:${bg};border:${border};
        cursor:pointer;opacity:${opacity};display:inline-flex;align-items:center;gap:3px;
      ">`;
      // Colored dot for action type
      html += `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${ts.text};"></span>`;
      html += `${esc(name)}`;
      if (pi < agentPath.length - 1) html += `</span><span style="color:#222;font-size:8px;">→</span>`;
      else html += `</span>`;
    }

    html += `</div></div>`;

    // Scrollable actions section
    html += `<div style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div style="font-size:9px;color:#333;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">ACTIONS ON THIS FILE — ${actions.length} operations</div>`;

    for (const a of actions) {
      const time = a.timestamp ? new Date(a.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
      const ts = getToolStyle(a.tool);

      html += `<div style="padding:8px 10px;border-left:3px solid ${ts.border};margin-bottom:6px;background:${ts.bg};">
        <div style="display:flex;gap:8px;align-items:baseline;margin-bottom:4px;">
          <span style="font-size:10px;color:${ts.text};text-transform:uppercase;letter-spacing:1px;font-weight:500;">${ts.label}</span>
          <span style="font-size:9px;color:#2a2a2a;">${time}</span>
          <span style="font-size:9px;color:#222;">step ${a.index + 1} of ${agentPath.length}</span>
        </div>`;

      if (a.tool === "Edit" && (a.oldString || a.newString)) {
        html += `<div style="margin-top:4px;font-family:'JetBrains Mono','Share Tech Mono',monospace;">`;
        if (a.oldString) {
          html += `<div style="background:#1a0808;padding:6px 10px;font-size:11px;color:#cc6666;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow-y:auto;border-left:2px solid #662222;margin-bottom:2px;">- ${esc(a.oldString)}</div>`;
        }
        if (a.newString) {
          html += `<div style="background:#081a08;padding:6px 10px;font-size:11px;color:#66cc66;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow-y:auto;border-left:2px solid #226622;">+ ${esc(a.newString)}</div>`;
        }
        html += `</div>`;
      } else if (a.tool === "Write" && a.newString) {
        // Write = entire file added
        html += `<div style="margin-top:4px;font-family:'JetBrains Mono','Share Tech Mono',monospace;">
          <div style="background:#081a08;padding:6px 10px;font-size:11px;color:#66cc66;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow-y:auto;border-left:2px solid #226622;">+ ${esc(a.newString)}</div>
        </div>`;
      } else if (a.tool === "Write") {
        html += `<div style="font-size:10px;color:#666;margin-top:2px;">new file created</div>`;
      } else if (a.tool === "Read") {
        html += `<div style="font-size:10px;color:#666;margin-top:2px;">file contents read into context</div>`;
      } else if (a.tool === "Grep") {
        html += `<div style="font-size:10px;color:#666;margin-top:2px;">searched file contents</div>`;
      }

      html += `</div>`;
    }

    html += `</div>`;

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Build unique node order for arrow key navigation
    const uniqueNodes = [];
    const seenNav = new Set();
    for (const step of agentPath) {
      if (!seenNav.has(step.node) && nodeActions[step.node]) {
        seenNav.add(step.node);
        uniqueNodes.push(step.node);
      }
    }
    const currentIdx = uniqueNodes.indexOf(node);

    // Close + arrow key handlers
    function cleanup() { overlay.remove(); document.removeEventListener("keydown", keyHandler); }

    function keyHandler(e) {
      if (e.key === "Escape") { cleanup(); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = uniqueNodes[currentIdx + 1];
        if (next) { cleanup(); showNodePopup(next); }
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = uniqueNodes[currentIdx - 1];
        if (prev) { cleanup(); showNodePopup(prev); }
      }
    }

    document.addEventListener("keydown", keyHandler);
    document.getElementById("node-popup-close").addEventListener("click", cleanup);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });

    // Timeline clicks — navigate to other nodes
    overlay.querySelectorAll(".timeline-node").forEach((el) => {
      el.addEventListener("click", () => {
        const targetNode = el.dataset.node;
        if (nodeActions[targetNode]) { cleanup(); showNodePopup(targetNode); }
      });
    });
  }

  sigma.on("clickNode", ({ node }) => showNodePopup(node));
  sigma.on("clickStage", () => {
    const overlay = document.getElementById("node-popup-overlay");
    if (overlay) overlay.remove();
  });
}

function esc(s) {
  return s ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
}

// Expose to global scope
window.FileGraph = { buildFileGraph, initSigma, applyActivity, setupNodeClick };
