import { App } from './app.js';
import { workshopFixture } from './workshop-fixture.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Timeline } from './timeline.js';
import './tokens.css';
const meta = { component:Timeline,title:'Timeline/Dated work',args:{value:{initiativeId:'01000000-0000-7000-8000-000000000001',items:[{id:'02000000-0000-7000-8000-000000000001',kind:'milestone',title:'Synthetic pilot checkpoint',date:'2026-11-15',state:'pending',href:'#initiatives/01000000-0000-7000-8000-000000000001/inspect/node/02000000-0000-7000-8000-000000000001'}],prerequisites:[{fromTitle:'Synthetic pilot checkpoint',toTitle:'Synthetic approval',href:'#initiatives/01000000-0000-7000-8000-000000000001'}]}}} satisfies Meta<typeof Timeline>;
export default meta;
type Story=StoryObj<typeof meta>;
export const DatedMilestone:Story={play:async({canvas,userEvent})=>{const link=canvas.getByRole('link',{name:'Synthetic pilot checkpoint'});await userEvent.tab();await expect(link).toHaveFocus();await expect(canvas.getByText(/depends on/)).toBeVisible();}};
export const NoDates:Story={args:{value:{initiativeId:meta.args.value.initiativeId,items:[],prerequisites:[]}}};

export const InApplication:Story={beforeEach:()=>{window.location.hash='#initiatives/01000000-0000-7000-8000-000000000001/timeline';},render:()=> <App platform={workshopFixture().platform}/>,play:async({canvas})=>{await canvas.findByRole('heading',{name:'Timeline',level:2});}};
