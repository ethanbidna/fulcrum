const required=['APPLE_CERTIFICATE','APPLE_CERTIFICATE_PASSWORD','APPLE_SIGNING_IDENTITY','APPLE_ID','APPLE_PASSWORD','APPLE_TEAM_ID','TAURI_SIGNING_PRIVATE_KEY','FULCRUM_UPDATER_PUBLIC_KEY'];
if(required.some(key=>!process.env[key]?.trim()))throw new Error('Configure every required release credential; no unsigned fallback');
if(!process.env.APPLE_SIGNING_IDENTITY.startsWith('Developer ID Application:'))throw new Error('Developer ID Application identity required');
