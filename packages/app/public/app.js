// Copy buttons (BC-023) and the select-all checkbox (BC-034). Everything
// else on the pages works without JavaScript.
(function () {
  'use strict';
  var announcer = document.getElementById('announcer');

  function announce(text) {
    if (announcer) {
      announcer.textContent = '';
      announcer.textContent = text;
    }
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'absolute';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('button.copy');
    if (!button) {
      return;
    }
    var value = button.getAttribute('data-copy') || '';
    var label = button.getAttribute('aria-label') || 'Copy';
    var write = navigator.clipboard && window.isSecureContext
      ? navigator.clipboard.writeText(value)
      : fallbackCopy(value);
    write.then(
      function () {
        button.textContent = 'Copied';
        button.setAttribute('data-copied', 'true');
        announce(label.replace(/^Copy /, '') + ' copied to clipboard');
        setTimeout(function () {
          button.textContent = 'Copy';
          button.removeAttribute('data-copied');
        }, 1500);
      },
      function () {
        button.textContent = 'Copy failed';
        announce('Copy failed. Select the value and copy it by hand.');
        setTimeout(function () {
          button.textContent = 'Copy';
        }, 2000);
      }
    );
  });

  var selectAll = document.getElementById('select-all');
  if (selectAll) {
    selectAll.addEventListener('change', function () {
      var boxes = document.querySelectorAll('input[name="ids"]');
      for (var i = 0; i < boxes.length; i++) {
        boxes[i].checked = selectAll.checked;
      }
    });
  }
})();
