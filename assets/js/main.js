document.querySelectorAll('[data-copy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.getAttribute('data-copy') || '';
    try { await navigator.clipboard.writeText(text); }
    catch (err) {
      const input = document.createElement('input');
      input.value = text; document.body.appendChild(input); input.select();
      document.execCommand('copy'); input.remove();
    }
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = '已复制：' + text;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1300);
  });
});
