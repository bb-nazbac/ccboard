// ccboard shell — command palette + theme management

(function () {
  // ============================================================
  // Theme
  // ============================================================

  const THEMES = {
    dark: {
      '--green': '#00ff41', '--green-dim': '#00aa2a', '--green-faint': '#004d15',
      '--amber': '#ffb000', '--amber-dim': '#aa7500', '--amber-faint': '#3d2a00',
      '--red': '#ff3333', '--red-dim': '#aa2222', '--red-faint': '#331111',
      '--cyan': '#00ffff', '--cyan-dim': '#008888', '--cyan-faint': '#002a2a',
      '--bg': '#0a0a0a', '--bg-card': '#0d0d0d', '--bg-card-hover': '#121212',
      '--border': '#1a1a1a', '--text': '#888', '--text-bright': '#ccc', '--text-dim': '#444',
    },
    light: {
      '--green': '#0a8a2a', '--green-dim': '#0a7a22', '--green-faint': '#d0f0d8',
      '--amber': '#b87800', '--amber-dim': '#8a5a00', '--amber-faint': '#fff3d0',
      '--red': '#cc2222', '--red-dim': '#992222', '--red-faint': '#fde0e0',
      '--cyan': '#0088aa', '--cyan-dim': '#006688', '--cyan-faint': '#d0f0f8',
      '--bg': '#f5f5f5', '--bg-card': '#ffffff', '--bg-card-hover': '#f0f0f0',
      '--border': '#e0e0e0', '--text': '#555', '--text-bright': '#222', '--text-dim': '#999',
    },
  };

  function applyTheme(name) {
    var vars = THEMES[name];
    if (!vars) return;
    var root = document.documentElement;
    for (var k in vars) {
      root.style.setProperty(k, vars[k]);
    }
    document.body.setAttribute('data-theme', name);
    localStorage.setItem('ccboard-theme', name);

    // Toggle scanlines and vignette
    var afterEl = document.body;
    if (name === 'light') {
      afterEl.classList.add('no-crt');
    } else {
      afterEl.classList.remove('no-crt');
    }
  }

  function getCurrentTheme() {
    return localStorage.getItem('ccboard-theme') || 'dark';
  }

  function toggleTheme() {
    applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
  }

  // Apply saved theme on load
  applyTheme(getCurrentTheme());

  // ============================================================
  // Command Palette
  // ============================================================

  var COMMANDS = [
    { id: 'theme-toggle', label: 'Toggle theme (dark/light)', keywords: 'theme dark light mode', action: toggleTheme },
    { id: 'theme-dark', label: 'Switch to dark theme', keywords: 'theme dark', action: function() { applyTheme('dark'); } },
    { id: 'theme-light', label: 'Switch to light theme', keywords: 'theme light', action: function() { applyTheme('light'); } },
    { id: 'go-dashboard', label: 'Go to dashboard', keywords: 'home dashboard sessions', action: function() { window.location.href = '/'; } },
  ];

  var paletteEl = null;
  var selectedIdx = 0;
  var filteredCommands = COMMANDS.slice();

  function createPalette() {
    if (paletteEl) return;

    paletteEl = document.createElement('div');
    paletteEl.id = 'cmd-palette-overlay';

    var inner = document.createElement('div');
    inner.id = 'cmd-palette';

    var input = document.createElement('input');
    input.type = 'text';
    input.id = 'cmd-input';
    input.placeholder = 'Type a command...';
    input.autocomplete = 'off';
    input.spellcheck = false;

    var results = document.createElement('div');
    results.id = 'cmd-results';

    inner.appendChild(input);
    inner.appendChild(results);
    paletteEl.appendChild(inner);
    document.body.appendChild(paletteEl);

    input.addEventListener('input', function() { filterCommands(input.value); });
    input.addEventListener('keydown', handlePaletteKeys);

    // Click overlay background to close
    paletteEl.addEventListener('mousedown', function(e) {
      if (e.target === paletteEl) closePalette();
    });

    // Click on result items — use delegation
    results.addEventListener('mousedown', function(e) {
      var item = e.target.closest('.cmd-item');
      if (item) {
        e.preventDefault();
        e.stopPropagation();
        var idx = Number(item.getAttribute('data-idx'));
        executeCommand(idx);
      }
    });

    filterCommands('');
    input.focus();
  }

  function closePalette() {
    if (paletteEl) {
      paletteEl.remove();
      paletteEl = null;
    }
  }

  function filterCommands(query) {
    var q = (query || '').toLowerCase().trim();
    filteredCommands = q
      ? COMMANDS.filter(function(c) { return c.label.toLowerCase().indexOf(q) !== -1 || c.keywords.indexOf(q) !== -1; })
      : COMMANDS.slice();
    selectedIdx = 0;
    renderResults();
  }

  function renderResults() {
    var container = document.getElementById('cmd-results');
    if (!container) return;

    var html = '';
    for (var i = 0; i < filteredCommands.length; i++) {
      var sel = i === selectedIdx ? ' cmd-selected' : '';
      html += '<div class="cmd-item' + sel + '" data-idx="' + i + '">' + filteredCommands[i].label + '</div>';
    }
    container.innerHTML = html;
  }

  function executeCommand(idx) {
    var cmd = filteredCommands[idx];
    if (!cmd) return;
    closePalette();
    setTimeout(function() { cmd.action(); }, 50);
  }

  function handlePaletteKeys(e) {
    if (e.key === 'Escape') { closePalette(); e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { selectedIdx = Math.min(selectedIdx + 1, filteredCommands.length - 1); renderResults(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { selectedIdx = Math.max(selectedIdx - 1, 0); renderResults(); e.preventDefault(); return; }
    if (e.key === 'Enter') { executeCommand(selectedIdx); e.preventDefault(); return; }
  }

  // Global shortcut: Cmd+Shift+P (Mac) or Ctrl+Shift+P (Win/Linux)
  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      if (paletteEl) closePalette();
      else createPalette();
    }
  });

  // Expose for external use
  window.ccboard = { applyTheme: applyTheme, toggleTheme: toggleTheme, getCurrentTheme: getCurrentTheme };
})();
