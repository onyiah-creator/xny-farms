/* =========================================================
   XNY Farms Limited — show/hide toggle for password fields

   Enhances EVERY input[type="password"] on the page, including ones added
   later (a MutationObserver watches for them), so any future password input
   gets an eye button automatically. Loaded directly by the admin pages and
   injected by js/main.js on any other page that has a password field.

   For each input:
     - it is moved (not cloned: autofill, value and listeners survive) into a
       <span class="pw-field"> wrapper, and a real <button type="button"> is
       added inside the right edge, with inline-SVG eye / eye-off icons;
     - the button toggles type between "password" and "text", has
       aria-label "Show password" / "Hide password" and aria-pressed, a 44px
       touch target and a visible focus ring, never submits the form, and keeps
       the caret where it was;
     - the field goes back to hidden when the form is submitted or reset, and
       when the input is cleared.
   ========================================================= */
(function () {
  "use strict";
  if (window.XNY_PASSWORD_TOGGLE) return;
  window.XNY_PASSWORD_TOGGLE = true;

  var EYE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9.9 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10.5 7 10.5 7a17.6 17.6 0 0 1-3.2 4"/>' +
    '<path d="M6.6 6.6C3.4 8.5 1.5 12 1.5 12S5.5 19 12 19c1.7 0 3.2-.5 4.5-1.2"/>' +
    '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';

  function setVisible(input, button, visible) {
    var start = null, end = null, dir = null;
    try { start = input.selectionStart; end = input.selectionEnd; dir = input.selectionDirection; } catch (e) { /* not supported for this state */ }
    var hadFocus = document.activeElement === input;
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", visible ? "true" : "false");
    button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    button.title = visible ? "Hide password" : "Show password";
    button.innerHTML = visible ? EYE_OFF : EYE;
    // Changing the type can reset the caret (and some browsers do it again after the click
    // finishes), so it is put back now and once more on the next tick.
    if (start !== null) {
      var restore = function () {
        try {
          if (hadFocus && document.activeElement !== input) input.focus();
          if (document.activeElement === input || !hadFocus) input.setSelectionRange(start, end, dir || "none");
        } catch (e) { /* ignore */ }
      };
      restore();
      window.setTimeout(restore, 0);
    }
  }

  function enhance(input) {
    if (!input || input.getAttribute("data-pw-toggle") === "1" || input.type !== "password") return;
    if (!input.parentNode) return;
    input.setAttribute("data-pw-toggle", "1");

    var wrap = document.createElement("span");
    wrap.className = "pw-field";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "pw-toggle";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", "Show password");
    button.title = "Show password";
    button.innerHTML = EYE;
    wrap.appendChild(button);

    function visible() { return input.type === "text"; }

    button.addEventListener("click", function () { setVisible(input, button, !visible()); });
    // A mouse or touch press must not move focus out of the input (it would lose the caret).
    button.addEventListener("mousedown", function (e) { if (document.activeElement === input) e.preventDefault(); });

    function hide() { if (visible()) setVisible(input, button, false); }
    input.addEventListener("input", function () { if (input.value === "") hide(); });
    var form = input.form || (input.closest && input.closest("form"));
    if (form) {
      form.addEventListener("submit", hide);
      form.addEventListener("reset", function () { window.setTimeout(hide, 0); });
    }
  }

  function scan(root) {
    var inputs = (root.querySelectorAll ? root.querySelectorAll('input[type="password"]') : []);
    Array.prototype.forEach.call(inputs, enhance);
    if (root.matches && root.matches('input[type="password"]')) enhance(root);
  }

  function start() {
    scan(document);
    if ("MutationObserver" in window) {
      new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) scan(n); });
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
