import type{Meta,StoryObj}from'@storybook/react-vite';import{expect,fn}from'storybook/test';
import{Onboarding}from'./onboarding.js';import{DesktopRoot}from'./desktop-root.js';import{setupWorkshop}from'./setup-workshop.js';import'./tokens.css';
const startup={configured:false,locations:[{id:'documents' as const,label:'In Documents',available:true},{id:'dropbox' as const,label:'In Dropbox',available:false},{id:'drive' as const,label:'In Google Drive',available:false}]};let fixture=setupWorkshop();
const meta={title:'Setup/Workspace onboarding',component:Onboarding,args:{platform:fixture.platform,startup,onDone:fn()},beforeEach:()=>{fixture=setupWorkshop();},parameters:{layout:'fullscreen'}}satisfies Meta<typeof Onboarding>;export default meta;type Story=StoryObj<typeof meta>;
export const Welcome:Story={render:args=><Onboarding {...args}platform={fixture.platform}/>};
export const CompleteWithoutAi:Story={render:args=><Onboarding {...args}platform={fixture.platform}/>,play:async({canvas,userEvent,args})=>{await userEvent.click(canvas.getByRole('button',{name:'Choose new workspace folder'}));await userEvent.clear(canvas.getByRole('textbox',{name:'Name this Mac'}));await userEvent.type(canvas.getByRole('textbox',{name:'Name this Mac'}),'Synthetic Desk Mac');await userEvent.click(canvas.getByRole('button',{name:'Open selected workspace'}));await userEvent.click(await canvas.findByRole('button',{name:'Continue to AI'}));await userEvent.click(await canvas.findByRole('button',{name:'Continue without AI'}));await userEvent.click(canvas.getByRole('button',{name:'Skip sources for now'}));await expect(canvas.queryByRole('textbox',{name:'Initiative title'})).not.toBeInTheDocument();await userEvent.click(await canvas.findByRole('button',{name:'Open Fulcrum'}));await expect(args.onDone).toHaveBeenCalled();await expect(fixture.transport.execute).not.toHaveBeenCalled();}};
export const ReviewProposals:Story={beforeEach:()=>{fixture.setProposals(['Synthetic proposed initiative','Synthetic second proposal']);},render:args=><Onboarding {...args}platform={fixture.platform}initialTransport={fixture.transport}/>,play:async({canvas,userEvent})=>{await userEvent.click(await canvas.findByRole('button',{name:'Continue to AI'}));await canvas.findByText('Off');await userEvent.click(await canvas.findByRole('button',{name:'Continue without AI'}));await userEvent.click(await canvas.findByRole('button',{name:'Skip sources for now'}));await canvas.findByRole('heading',{name:'Review proposed initiatives'});await expect(canvas.queryByRole('textbox',{name:'Initiative title'})).not.toBeInTheDocument();await userEvent.click(canvas.getByRole('button',{name:'Approve Synthetic proposed initiative'}));await userEvent.click(canvas.getByRole('button',{name:'Reject Synthetic second proposal'}));await userEvent.click(await canvas.findByRole('button',{name:'Continue'}));await canvas.findByRole('button',{name:'Open Fulcrum'});}};
export const ExistingWorkspace:Story={beforeEach:()=>{fixture.setWorkspace({people:[{id:'08000000-0000-7000-8000-000000000002',label:'Synthetic owner'}],ingestionDeviceId:'09000000-0000-7000-8000-000000000002'});},render:args=><Onboarding {...args}platform={fixture.platform}initialTransport={fixture.transport}/>,play:async({canvas,userEvent})=>{const next=await canvas.findByRole('button',{name:'Continue to AI'});await expect(next).toBeDisabled();await userEvent.selectOptions(canvas.getByRole('combobox',{name:'Which person is you in this workspace?'}),'08000000-0000-7000-8000-000000000002');await userEvent.click(canvas.getByRole('radio',{name:'Use this Mac as the ingestion device'}));await expect(next).toBeDisabled();await userEvent.click(canvas.getByRole('checkbox',{name:'Move ingestion to this Mac; I will reconnect credentials and choose scopes here.'}));await expect(next).toBeEnabled();}};
export const FolderFailure:Story={render:args=><Onboarding {...args}platform={{...fixture.platform,setup:{...fixture.platform.setup!,choose:fn(async()=>{throw new Error('Denied');})}}}/>,play:async({canvas,userEvent})=>{await userEvent.click(canvas.getByRole('button',{name:'Choose new workspace folder'}));await canvas.findByRole('alert');await expect(canvas.getByRole('button',{name:'Open an existing Fulcrum workspace'})).toBeEnabled();}};
export const NativeStartup:Story={render:()=> <DesktopRoot platform={fixture.platform}/>};

export const ConnectDuringSetup: Story = {
  render: args => <Onboarding {...args} platform={fixture.platform} initialTransport={fixture.transport} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Continue to AI' }));
    await canvas.findByText('Off');
    await userEvent.click(await canvas.findByRole('button', { name: 'Continue without AI' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }));
    await userEvent.click(canvas.getByRole('checkbox', { name: 'I agree to connect Gmail through Activepieces.' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Continue to Gmail in browser' }));
    await expect(fixture.administer).toHaveBeenCalledWith('sources.connect', { source: 'gmail', acknowledged: true });
    await userEvent.click(await canvas.findByRole('button', { name: 'Cancel Gmail connection' }));
    await expect(fixture.administer).toHaveBeenCalledWith('sources.cancel', { source: 'gmail' });
  },
};

export const InstallConnectionsDuringSetup: Story = {
  beforeEach: () => { fixture.setRuntime('not_installed'); },
  render: args => <Onboarding {...args} platform={fixture.platform} initialTransport={fixture.transport} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Continue to AI' }));
    await canvas.findByText('Off'); await userEvent.click(canvas.getByRole('button', { name: 'Continue without AI' }));
    const install = await canvas.findByRole('button', { name: 'Download and set up connections' }); await expect(install).toBeDisabled();
    await userEvent.click(canvas.getByRole('checkbox', { name: 'I agree to download and run the local connection service.' }));
    await userEvent.click(install); await canvas.findByText('Connection service ready. Importing is off.');
    await expect(fixture.administer).toHaveBeenCalledWith('sources.runtime.start', { acknowledged: true });
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Slack' }));
    await userEvent.click(canvas.getByRole('checkbox', { name: 'I agree to connect Slack through Activepieces.' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Continue to Slack in browser' }));
    await expect(fixture.administer).toHaveBeenCalledWith('sources.connect', { source: 'slack', acknowledged: true });
  },
};
