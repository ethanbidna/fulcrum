import { useEffect, useState } from 'react';
import type { AdministrationResults, McpConfiguration, McpActivityEntry } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
type Administer = NonNullable<CoreTransport['administer']>;
interface Props { administer: Administer }
const DEFAULTS: McpConfiguration = {enabled:false,readOnly:true,sharingAcknowledged:false,sourceExcerpts:false,questionsVisible:true};
export function McpSettings({administer}:Props){
  const [data,setData]=useState<AdministrationResults['mcp.status']>();
  const [draft,setDraft]=useState<McpConfiguration>(DEFAULTS);
  const [activity,setActivity]=useState<McpActivityEntry[]>();
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);const [retry,setRetry]=useState(0);const [installConfirmed,setInstallConfirmed]=useState(false);
  useEffect(()=>{let disposed=false;setError('');void administer('mcp.status',{}).then(value=>{if(!disposed){setData(value);setDraft(value.access);}}).catch(()=>{if(!disposed)setError('Could not load MCP settings. Retry to reconnect.');});return()=>{disposed=true;};},[administer,retry]);
  async function perform(operation:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await operation();}catch{setError('MCP setup could not finish. Check the core connection and local configuration, then retry.');}finally{setBusy(false);}}
  if(!data)return <>{error?<><p role="alert">{error}</p><button className="secondary-button" onClick={()=>setRetry(value=>value+1)}>Retry MCP settings</button></>:<p role="status">Loading MCP settings…</p>}</>;
  const unsaved=JSON.stringify(draft)!==JSON.stringify(data.access);
  const scope=draft.initiativeIds?'initiatives':draft.categoryIds?'categories':'all';
  return <div className="mcp-settings">{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <p>MCP clients such as Claude Desktop send what Fulcrum returns to their AI provider’s servers. Fulcrum’s own AI stays on this Mac, but anything you let an MCP client read may leave it. Choose what to share.</p>
    <form onSubmit={event=>{event.preventDefault();void perform(async()=>{const access=await administer('mcp.configure',draft);setData({...data,access});setDraft(access);setNotice('MCP sharing settings saved on this Mac.');});}}>
      <label className="check-label"><input type="checkbox" checked={draft.sharingAcknowledged} disabled={busy} onChange={event=>setDraft({...draft,sharingAcknowledged:event.target.checked,enabled:event.target.checked&&draft.enabled})}/>I understand that returned data may leave this Mac through my MCP client.</label>
      <label className="check-label"><input type="checkbox" checked={draft.enabled} disabled={busy||!draft.sharingAcknowledged} onChange={event=>setDraft({...draft,enabled:event.target.checked})}/>Allow MCP clients</label>
      <label>Access<select value={draft.readOnly?'read':'write'} disabled={busy} onChange={event=>setDraft({...draft,readOnly:event.target.value==='read'})}><option value="read">Read-only</option><option value="write">Read and write</option></select></label>
      <label>Initiatives to share<select value={scope} disabled={busy} onChange={event=>{const {initiativeIds:_initiatives,categoryIds:_categories,...rest}=draft;void _initiatives;void _categories;setDraft({...rest,...(event.target.value==='initiatives'?{initiativeIds:[]}:event.target.value==='categories'?{categoryIds:[]}:{})});}}><option value="all">All initiatives</option><option value="categories">Selected categories</option><option value="initiatives">Selected initiatives</option></select></label>
      {scope!=='all'&&<fieldset disabled={busy}><legend>{scope==='initiatives'?'Shared initiatives':'Shared categories'}</legend>{(scope==='initiatives'?data.initiatives.map(item=>({id:item.id,label:item.title})):data.categories.map(item=>({id:item.id,label:item.name}))).map(item=>{const selected=scope==='initiatives'?draft.initiativeIds??[]:draft.categoryIds??[];return <label className="check-label" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event=>{const ids=event.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id);setDraft({...draft,...(scope==='initiatives'?{initiativeIds:ids}:{categoryIds:ids})});}}/>{item.label}</label>;})}<p>With none selected, no initiatives are shared. Views that require excluded records are denied.</p></fieldset>}
      <label className="check-label"><input type="checkbox" checked={draft.sourceExcerpts} disabled={busy} onChange={event=>setDraft({...draft,sourceExcerpts:event.target.checked})}/>Share retained source excerpts</label>
      <label className="check-label"><input type="checkbox" checked={draft.questionsVisible} disabled={busy} onChange={event=>setDraft({...draft,questionsVisible:event.target.checked})}/>Show contextual questions</label>
      <button className="secondary-button" disabled={busy}>Save MCP settings</button>
    </form>
    <h3>Claude Desktop</h3>{unsaved&&<p role="status">Save your sharing changes before adding the client.</p>}<p>Save sharing settings before adding the client. Existing client entries are preserved and the configuration is backed up. Fully quit and reopen Claude Desktop after installation.</p>
    <label className="check-label"><input type="checkbox" disabled={busy||unsaved||!data.access.enabled} checked={installConfirmed} onChange={event=>setInstallConfirmed(event.target.checked)}/>Add Fulcrum to my Claude Desktop configuration.</label>
    <button className="secondary-button" disabled={busy||unsaved||!data.access.enabled||!installConfirmed} onClick={()=>{void perform(async()=>{await administer('mcp.install',{confirmed:true});setNotice('Fulcrum added. Fully quit and reopen Claude Desktop.');});}}>Add to Claude Desktop</button>
    <h3>Activity on this Mac</h3><button className="secondary-button" disabled={busy} onClick={()=>{void perform(async()=>{setActivity(await administer('mcp.activity',{}));});}}>Refresh MCP activity</button>{activity&&(activity.length?<ul>{activity.map((entry,index)=><li key={`${entry.at}-${index}`}>{new Date(entry.at).toLocaleString()} · {entry.tool} · {entry.outcome}{entry.recordIds.length?` · ${entry.recordIds.length} records`:''}</li>)}</ul>:<p>No MCP calls recorded.</p>)}
  </div>;
}
