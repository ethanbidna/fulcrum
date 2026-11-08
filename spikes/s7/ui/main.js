const status = document.getElementById('status');
async function refresh() {
  try {
    const result = await window.__TAURI__.core.invoke('health');
    status.textContent = JSON.stringify(result, null, 2);
  } catch {
    status.textContent = 'Sidecar unavailable. Check the packaging procedure.';
  }
}
document.getElementById('refresh').addEventListener('click', refresh);
refresh();
