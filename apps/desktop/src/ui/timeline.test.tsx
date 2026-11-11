// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/react';
import { App } from './app.js';
import { initiativeFromHash, initiativeViewFromHash } from './navigation.js';
import type { CoreTransport } from '../core-transport.js';
afterEach(()=>{cleanup();window.location.hash='';});
const initiativeId='01000000-0000-7000-8000-000000000001';
test('Timeline routes preserve initiative identity; undated work has no Timeline tab or synthetic schedule',async()=>{
 const initiative={id:initiativeId,title:'Synthetic undated work'};
 const board={cards:[{initiative}],rail:{questionCount:0},questionCounts:{},categories:[],teams:[],objectives:[]};
 const query=vi.fn(async(name:string)=> name==='portfolio.board'?board:name==='initiative.timeline'?{initiativeId,items:[],prerequisites:[]}:initiative);
 const transport={query,execute:vi.fn(),subscribe:async()=>()=>{},close:()=>{}} as unknown as CoreTransport;
 window.location.hash=`#initiatives/${initiativeId}/timeline`;
 expect(initiativeFromHash(window.location.hash)).toBe(initiativeId);expect(initiativeViewFromHash(window.location.hash)).toBe('timeline');
 render(<App platform={{connectCore:async()=>transport}}/>);
 await screen.findByRole('heading',{name:'No dated work yet'});expect(screen.queryByRole('link',{name:'Timeline'})).toBeNull();expect(transport.execute).not.toHaveBeenCalled();
 await act(async()=>{window.location.hash=`#initiatives/${initiativeId}/context`;window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(initiativeViewFromHash(window.location.hash)).toBe('context');
});
