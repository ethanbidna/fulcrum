// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { claimText, EvidencePanel } from './evidence.js';
import type { ContextEvidence, PortfolioBoard } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
import { initiativeFromHash, initiativeViewFromHash } from './navigation.js';
afterEach(cleanup);
const initiativeId='01000000-0000-7000-8000-000000000001';
test('Context routes preserve the initiative and evidence failures offer retry', async()=>{
 const hash=`#initiatives/${initiativeId}/context`;expect(initiativeFromHash(hash)).toBe(initiativeId);expect(initiativeViewFromHash(hash)).toBe('context');
 const query=vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue([]);
 render(<EvidencePanel scope={{initiativeId}} board={{} as PortfolioBoard} query={query as CoreTransport['query']}/>);
 await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Retry evidence'}));await screen.findByText(/No evidence linked/);expect(query).toHaveBeenCalledTimes(2);expect(query).toHaveBeenLastCalledWith('evidence.list',{initiativeId});
});
test('an obsolete selection response cannot reveal evidence for the wrong object',async()=>{
 let finish!: (rows:ContextEvidence[])=>void;
 const query=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue([]);
 const board={} as PortfolioBoard; const view=render(<EvidencePanel scope={{initiativeId,target:{kind:'node',id:'old'}}} board={board} query={query as CoreTransport['query']}/>);
 view.rerender(<EvidencePanel scope={{initiativeId,target:{kind:'node',id:'new'}}} board={board} query={query as CoreTransport['query']}/>);
 await screen.findByText(/No evidence linked/);finish([{sourceId:'old',targets:[{kind:'node',id:'old',label:'Obsolete source'}],assertions:[]}]);
 expect(screen.queryByText('Obsolete source')).toBeNull();
});

test('claims use product language with readable unknown fields',()=>{expect(claimText('user_commitment','Prepare sample')).toBe('Your commitment: Prepare sample');expect(claimText('prerequisite',true)).toBe('Prerequisite confirmed');expect(claimText('prerequisite',false)).toBe('Prerequisite not confirmed');expect(claimText('custom_claim',{test_value:true})).toBe('Custom claim: Test value: Yes');});
