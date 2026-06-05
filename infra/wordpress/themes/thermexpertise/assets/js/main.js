/* THERM Expertise — minimal front-end behaviour */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    // Mobile nav toggle.
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.site-header .nav');
    if (toggle && nav) {
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      // Close the menu after following a link.
      nav.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') {
          nav.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }
  });
})();
