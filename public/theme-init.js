// Applies the saved theme before first paint so there is no light/dark flash. Kept as a file (not inline) so the CSP can stay strict.
try {
  var t = JSON.parse(localStorage.getItem('gaffer:theme') || '"system"');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
