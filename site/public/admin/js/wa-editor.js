(function (global) {
  const EMOJIS = [
    '😀', '😊', '🙂', '😉', '😍', '🥰', '😘', '🤗', '🤩', '😎',
    '🙏', '👍', '👏', '💪', '✨', '⭐', '🎉', '🔥', '❤️', '💚',
    '💙', '💜', '🌟', '✅', '☑️', '📅', '🕐', '📍', '👉', '💬',
  ];

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /** Convierte marcado estilo WhatsApp a HTML seguro para vista previa */
  function waToHtml(text) {
    let s = escapeHtml(text || '');
    s = s.replace(/```([^`]+)```/g, '<code>$1</code>');
    s = s.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
    s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    s = s.replace(/~([^~\n]+)~/g, '<del>$1</del>');
    return s;
  }

  function create(root, options) {
    options = options || {};
    const placeholder = options.placeholder || 'Escribe tu mensaje...';

    root.innerHTML =
      '<div class="wa-editor">' +
        '<div class="wa-toolbar">' +
          '<button type="button" data-wa="bold" title="Negrita (*texto*)"><b>B</b></button>' +
          '<button type="button" data-wa="italic" title="Cursiva (_texto_)"><i>I</i></button>' +
          '<button type="button" data-wa="strike" title="Tachado (~texto~)"><s>S</s></button>' +
          '<button type="button" data-wa="mono" title="Monoespaciado (```texto```)">{ }</button>' +
          '<span class="wa-sep"></span>' +
          '<button type="button" data-wa="bullet" title="Viñeta">• Lista</button>' +
          '<div class="wa-emoji-wrap">' +
            '<button type="button" data-wa="emoji" title="Emoticones">😊</button>' +
            '<div class="wa-emoji-pop" id="wa-emoji-pop"></div>' +
          '</div>' +
        '</div>' +
        '<textarea class="wa-textarea" placeholder="' + escapeHtml(placeholder) + '"></textarea>' +
        '<div class="wa-preview-wrap">' +
          '<div class="wa-preview-label">Vista previa WhatsApp</div>' +
          '<div class="wa-preview"></div>' +
        '</div>' +
      '</div>';

    const textarea = root.querySelector('.wa-textarea');
    const preview = root.querySelector('.wa-preview');
    const emojiPop = root.querySelector('.wa-emoji-pop');

    emojiPop.innerHTML = EMOJIS.map(function (e) {
      return '<button type="button" data-emoji="' + e + '">' + e + '</button>';
    }).join('');

    function updatePreview() {
      preview.innerHTML = waToHtml(textarea.value) || '<span style="opacity:.5">...</span>';
    }

    function wrap(before, after) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      const sel = val.substring(start, end) || 'texto';
      textarea.value = val.substring(0, start) + before + sel + after + val.substring(end);
      const pos = start + before.length + sel.length + after.length;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
      updatePreview();
    }

    function insertBullet() {
      const start = textarea.selectionStart;
      const val = textarea.value;
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const prefix = val.substring(lineStart, start);
      if (/^•\s?/.test(prefix)) return;
      textarea.value = val.substring(0, lineStart) + '• ' + val.substring(lineStart);
      textarea.focus();
      textarea.setSelectionRange(start + 2, start + 2);
      updatePreview();
    }

    function insertEmoji(emoji) {
      const start = textarea.selectionStart;
      const val = textarea.value;
      textarea.value = val.substring(0, start) + emoji + val.substring(start);
      const pos = start + emoji.length;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
      emojiPop.classList.remove('show');
      updatePreview();
    }

    root.querySelector('.wa-toolbar').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-wa]');
      if (!btn) return;
      e.preventDefault();
      const action = btn.dataset.wa;
      if (action === 'bold') wrap('*', '*');
      else if (action === 'italic') wrap('_', '_');
      else if (action === 'strike') wrap('~', '~');
      else if (action === 'mono') wrap('```', '```');
      else if (action === 'bullet') insertBullet();
      else if (action === 'emoji') emojiPop.classList.toggle('show');
    });

    emojiPop.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-emoji]');
      if (!btn) return;
      insertEmoji(btn.dataset.emoji);
    });

    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) emojiPop.classList.remove('show');
    });

    textarea.addEventListener('input', updatePreview);

    return {
      getValue: function () { return textarea.value; },
      setValue: function (v) {
        textarea.value = v || '';
        updatePreview();
      },
      focus: function () { textarea.focus(); },
    };
  }

  global.WaEditor = { create, waToHtml };
})(window);
