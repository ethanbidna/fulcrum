// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { projectBoard } from '@fulcrum/domain';
import type { WorkspaceState } from '@fulcrum/domain';
vi.mock('./flow-canvas.js',()=>({FlowCanvas:({onInspectionChange}:{onInspectionChange:(target:undefined)=>void})=>{useEffect(()=>{onInspectionChange(undefined);},[onInspectionChange]);return <h2>Focused canvas ready</h2>;}}));
import { App } from './app.js';
const INITIATIVE='01000000-0000-7000-8000-000000000001';const ROOT='02000000-0000-7000-8000-000000000002';
afterEach(()=>{cleanup();window.location.hash='';});
test('a focused Task remains the command target when canvas selection is cleared',async()=>{
  const state=JSON.parse(readFileSync('fixtures/states/portfolio.state.json','utf8')).state as WorkspaceState;
  const planCommand=vi.fn().mockResolvedValue({id:'synthetic-plan',changes:[],expiresAt:'2026-11-09T18:00:00Z',prompt:'Add a child task'});
  const transport={query:vi.fn(async(name:string)=>name==='initiative.get'?state.initiatives[0]:projectBoard(state,[],{now:'2026-11-09T16:00:00Z'})),execute:vi.fn(),subscribe:vi.fn().mockResolvedValue(()=>{}),close:vi.fn(),planCommand,cancelCommandPlan:vi.fn().mockResolvedValue(undefined)};
  window.location.hash=`#initiatives/${INITIATIVE}/focus/${ROOT}`;
  render(<App platform={{connectCore:async()=>transport} as never}/>);await screen.findByText('Focused canvas ready');
  fireEvent.change(screen.getByRole('textbox',{name:'What would you like to change?'}),{target:{value:'Add a child task'}});fireEvent.click(screen.getByRole('button',{name:'Review command'}));
  await waitFor(()=>expect(planCommand).toHaveBeenCalledWith({prompt:'Add a child task',initiativeId:INITIATIVE,target:{kind:'node',id:ROOT}}));
});
