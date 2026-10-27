# dom-minimap 0.6.0 adapter

Source: https://github.com/gavinlees/dom-minimap
Package: @gavinlees/dom-minimap@0.6.0 (MIT; see LICENSE).
Original source SHA-256: 1eec1106577066db304500402c3702fe73c791b12ac57db7e559af29789b99c9

The runtime is vendored to keep this optional feature self-contained and avoid patching node_modules.
Local changes: ES module export; cloneNode callback before descending into complex nodes; managed refresh/resize mode and batched splice geometry; resize-only layout update; host-relative positioning; source-content offset within a scroll container; cancellation of pending animation frames and pointer cleanup; preserve browser zoom on modified wheel events; commit the final coalesced pointer sample on release; preserve the viewport grab offset during drag; invert rendered scale/translation for content clicks and use the actual miniature travel for dragging.

The upstream rendering, ID isolation and incremental splicing remain in use. Local pointer mapping follows the displayed miniature rather than the full track fraction. Only the independent controller supplies source-DOM cloning and update scheduling. Do not run package unit tests in this project.
