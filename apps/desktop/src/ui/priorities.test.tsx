// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ObjectiveForm } from './priorities.js';
afterEach(cleanup);
test('objective edit saves rank and KPI in one domain command and keeps rejected drafts',async()=>{
 const execute=vi.fn().mockResolvedValue({ok:false,error:{message:'Synthetic conflict'}});const close=vi.fn();
 render(<ObjectiveForm objective={{id:'07000000-0000-7000-8000-000000000001',label:'Synthetic objective',rank:1}} nextRank={1} execute={execute} close={close}/>);
 fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Revised objective'}});fireEvent.change(screen.getByLabelText('Rank'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Relative weight'),{target:{value:'5'}});
 fireEvent.change(screen.getByLabelText('KPI name'),{target:{value:'Synthetic savings'}});fireEvent.change(screen.getByLabelText('Current'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('Target'),{target:{value:'10'}});fireEvent.click(screen.getByRole('button',{name:'Save objective'}));
 await screen.findByRole('alert');expect(close).not.toHaveBeenCalled();expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Revised objective');
 expect(execute).toHaveBeenCalledWith({name:'command.apply',args:{commands:[{name:'objective.update',args:{id:'07000000-0000-7000-8000-000000000001',patch:{label:'Revised objective',weight:5,kpi:{name:'Synthetic savings',current:0,target:10}}}},{name:'objective.rerank',args:{ranks:[{id:'07000000-0000-7000-8000-000000000001',rank:2}]}}]}});
});
