// Apply the existing website preference before painting; storage is optional.
function applyTheme(){try{const theme=localStorage.getItem('nosus-theme');if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;else delete document.documentElement.dataset.theme;}catch{}}
applyTheme();
window.addEventListener('storage',event=>{if(event.key==='nosus-theme'||event.key===null)applyTheme();});

if(window.parent!==window)document.documentElement.dataset.embedded='true';
