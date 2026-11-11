// @vitest-environment jsdom
import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {CoreTransport} from '../core-transport.js';
import type {InitiativeHistoryEntry,InitiativeListRow,PortfolioBoard} from '@fulcrum/domain';
import {ListView,HistoryView} from './detail-views.js';
import {initiativeFromHash,initiativeViewFromHash} from './navigation.js';
afterEach(cleanup);
const initiativeId='01000000-0000-7000-8000-000000000001';
const row={node:{id:'02000000-0000-7000-8000-000000000001',initiativeId,type:'task',title:'Synthetic task',state:'open'},depth:1,parentId:'synthetic-parent',role:'You',sourceCount:2,prerequisites:[]} as unknown as InitiativeListRow;
const board={} as PortfolioBoard;
function props(){return {initiativeId,board,query:vi.fn().mockResolvedValue([row]) as unknown as CoreTransport['query'],execute:vi.fn().mockResolvedValue({ok:true,eventId:'synthetic-event'}),onInspectionChange:vi.fn()};}
test('list title edits use shared commands; rejected drafts survive projection refresh',async()=>{
 const f=props();f.execute.mockResolvedValue({ok:false,error:{message:'Synthetic rejection'}});const view=render(<ListView {...f}/>);
 const input=await screen.findByRole('textbox',{name:'Title for Synthetic task'});fireEvent.focus(input);fireEvent.change(input,{target:{value:'Synthetic revised task'}});fireEvent.keyDown(input,{key:'Enter'});
 await screen.findByRole('alert');expect(f.execute).toHaveBeenCalledWith({name:'node.update',args:{id:row.node.id,patch:{title:'Synthetic revised task'}}});expect(f.onInspectionChange).toHaveBeenCalledWith({kind:'node',id:row.node.id});
 view.rerender(<ListView {...f} board={{...board}}/>);await waitFor(()=>expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Synthetic revised task'));
 fireEvent.keyDown(screen.getByRole('textbox'),{key:'Escape'});expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Synthetic task');
});
test('history sends exact event/run undo and preserves conflict errors',async()=>{
 const entry={eventId:'synthetic-event',actor:'ai',at:'2026-11-09T18:00:00Z',command:{name:'node.update',args:{}},changes:[{id:row.node.id,label:'Change title: Synthetic task',beforeText:'Before title',afterText:'After title'}],evidence:[{id:'synthetic-source',title:'Synthetic evidence',permalink:'https://example.com/evidence'}],undone:false,runId:'synthetic-run',runEventCount:2,runInitiativeCount:2} as unknown as InitiativeHistoryEntry;
 const f=props();f.query=vi.fn().mockResolvedValue([entry]) as unknown as CoreTransport['query'];f.execute.mockResolvedValue({ok:false,error:{message:'A later edit conflicts'}});render(<HistoryView {...f}/>);
 await screen.findByRole('button',{name:'Undo change'});expect(screen.getByRole('link',{name:'Synthetic evidence'}).getAttribute('href')).toBe('https://example.com/evidence');
 fireEvent.click(screen.getByRole('button',{name:'Undo change'}));await screen.findByRole('alert');expect(f.execute).toHaveBeenLastCalledWith({name:'change.undo',args:{eventId:'synthetic-event'}});
 fireEvent.click(screen.getByRole('button',{name:'Undo AI run'}));await waitFor(()=>expect(f.execute).toHaveBeenLastCalledWith({name:'run.undo',args:{runId:'synthetic-run'}}));
});
test('list and history have stable initiative routes',()=>{
 for(const view of ['list','history'] as const){const hash=`#initiatives/${initiativeId}/${view}`;expect(initiativeFromHash(hash)).toBe(initiativeId);expect(initiativeViewFromHash(hash)).toBe(view);}
 expect(initiativeFromHash('#initiatives/not-an-id/list')).toBeUndefined();
});
