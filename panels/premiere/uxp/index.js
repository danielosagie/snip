const { entrypoints } = require("uxp");

entrypoints.setup({
  panels: {
    snipTimelinePanel: {
      show(rootNode) {
        const panel = document.getElementById("snip-panel");
        if (panel && !panel.parentNode) rootNode.appendChild(panel);
      },
    },
  },
});
