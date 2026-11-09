// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommandPlan } from '@fulcrum/domain';
import { CommandBar } from './command-bar.js';
afterEach(cleanup);
const preview: CommandPlan = { id:'synthetic-plan',prompt:'Add a draft',expiresAt:'2026-11-09T16:00:00Z',changes:[{kind:'node',id:'synthetic',operation:'create',before:null,after:{title:'Synthetic draft'},label:'Create Task: Synthetic draft',beforeText:'Not set',afterText:'title: Synthetic draft · state: open'}] };
function props() {return {plan:vi.fn().mockResolvedValue(preview),apply:vi.fn().mockResolvedValue({ok:true,eventId:'synthetic-event'}),cancel:vi.fn().mockResolvedValue(undefined),undo:vi.fn().mockResolvedValue({ok:true,eventId:'synthetic-undo'})};}
function typeRequest(){fireEvent.change(screen.getByRole('textbox',{name:'What would you like to change?'}),{target:{value:'Add a draft'}});fireEvent.click(screen.getByRole('button',{name:'Review command'}));}
test('request previews without writes; explicit apply and exact-event undo use the shared commands', async()=>{
  const f=props();render(<CommandBar {...f} initiativeId="synthetic-initiative"/>);typeRequest();await screen.findByRole('heading',{name:'Review changes'});
  expect(f.plan).toHaveBeenCalledWith({prompt:'Add a draft',initiativeId:'synthetic-initiative'});expect(f.apply).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('region',{name:'Command bar'}),{key:'Enter',metaKey:true});await screen.findByRole('button',{name:'Undo command'});expect(f.apply).toHaveBeenCalledWith('synthetic-plan');
  fireEvent.click(screen.getByRole('button',{name:'Undo command'}));await waitFor(()=>expect(f.undo).toHaveBeenCalledWith('synthetic-event'));
});
test('ambiguous and rejected requests retain the text and show the error',async()=>{
  const f=props();f.plan.mockRejectedValueOnce(new Error('Which synthetic draft?'));render(<CommandBar {...f}/>);typeRequest();await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toBe('Which synthetic draft?');expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Add a draft');expect(f.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Review command'}));await screen.findByRole('heading',{name:'Review changes'});f.apply.mockResolvedValue({ok:false,error:{message:'Workspace changed. Review again.'}});fireEvent.click(screen.getByRole('button',{name:'Apply changes'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Workspace changed'));expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Add a draft');
});
test('Escape cancels and ignores an obsolete model response; Command K focuses the entry',async()=>{
  const f=props();let finish!:(value:CommandPlan)=>void;f.plan.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<CommandBar {...f}/>);typeRequest();await screen.findByText('Planning locally…');
  fireEvent.keyDown(screen.getByRole('textbox'),{key:'Escape'});finish(preview);await waitFor(()=>expect(screen.queryByRole('heading',{name:'Review changes'})).toBeNull());expect(f.apply).not.toHaveBeenCalled();
  fireEvent.keyDown(window,{key:'k',metaKey:true});expect(document.activeElement).toBe(screen.getByRole('textbox'));
});
test('changing the focused object invalidates an outstanding command draft',async()=>{
  const f=props();let finish!:(value:CommandPlan)=>void;f.plan.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<CommandBar {...f} target={{kind:'node',id:'synthetic-first'}}/>);typeRequest();await screen.findByText('Planning locally…');
  view.rerender(<CommandBar {...f} target={{kind:'node',id:'synthetic-second'}}/>);await act(async()=>{finish(preview);});
  await waitFor(()=>expect(screen.queryByRole('heading',{name:'Review changes'})).toBeNull());expect(f.apply).not.toHaveBeenCalled();
});
