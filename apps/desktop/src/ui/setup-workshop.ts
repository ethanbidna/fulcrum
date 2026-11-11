import{fn}from'storybook/test';
import type{AiSetupStatus,AiProfile,AiJob,OriginPreference,ModelChoice,PortfolioBoard,AdministrationResults}from'@fulcrum/domain';
import type{CoreTransport}from'../core-transport.js';import type{Platform}from'../platform/platform.js';
const GIB=1024**3;
const common={license:'Synthetic fixture license',licenseUrl:'https://example.test/license',baseDeveloper:'Synthetic developer',baseDeveloperCountry:'US',originSource:'https://example.test/developer',dataPolicyUrl:'https://example.test/privacy',downloadBytes:2*GIB,memoryBytes:6*GIB,diskRequiredBytes:7*GIB,validation:'Synthetic fixture; no model was measured'};
export const syntheticChoices:ModelChoice[]=[
 {...common,id:'synthetic-local',name:'Synthetic local model',kind:'local',model:'synthetic:small',developer:'Synthetic US developer',developerCountry:'US',processingLocation:'On this Mac'},
 {...common,id:'synthetic-china',name:'Synthetic China model',kind:'local',model:'synthetic:alternative',developer:'Synthetic China developer',developerCountry:'CN',baseDeveloper:'Synthetic China developer',baseDeveloperCountry:'CN',processingLocation:'On this Mac'},
 {...common,id:'synthetic-hosted',name:'Synthetic hosted model',kind:'hosted',model:'synthetic-hosted',developer:'Synthetic provider',developerCountry:'US',processingLocation:'Global processing; developer country is separate',downloadBytes:null,memoryBytes:null,diskRequiredBytes:null},
];
const EMPTY_BOARD:PortfolioBoard={cards:[],categories:[],teams:[],objectives:[],questionCounts:{},rail:{nextAvailableActions:[],waitingOn:[],meaningfulChanges:[],questionCount:0}};
export function setupWorkshop(){
 let preference:OriginPreference={homeCountry:'',domesticOnly:false,excludedCountries:[],search:''};let profile:AiProfile={kind:'none'};let job:AiJob={phase:'cancelled'};let completed=false;
 let hardware:AiSetupStatus['hardware']={architecture:'intel',availableMemoryBytes:16*GIB,totalMemoryBytes:32*GIB,availableDiskBytes:100*GIB,runtimeSupported:true,runtimeReason:null};
 let workspace:AdministrationResults['workspace.setupStatus']={completed:false,deviceId:'09000000-0000-7000-8000-000000000001',deviceLabel:'Synthetic Mac',ingestionDeviceId:null,people:[],userEntityId:'08000000-0000-7000-8000-000000000001'};
 const administer=fn(async(name:string,args:Record<string,unknown>)=>{
  if(name==='ai.status')return{hardware,profile,preference,choices:syntheticChoices,suggestionId:'synthetic-local',runtimeDownloadBytes:200*1024**2,runtimeVersion:'Synthetic runtime',hostedSupported:true};
  if(name==='ai.preferences'){preference=args.preference as OriginPreference;return preference;}
  if(name==='ai.start'){const choice=syntheticChoices.find(item=>item.id===args.choiceId)!;profile={kind:choice.kind,choiceId:choice.id,compatibility:{structuredOutput:true,latencyMs:250,processRssBytes:80*1024**2,modelResidentBytes:choice.kind==='local'?3*GIB:null,slow:false,at:'2026-11-10T12:00:00Z'}};job={phase:'ready',profile};return{id:'synthetic-setup-job'};}
  if(name==='ai.job')return job;
  if(name==='ai.cancel'){job={phase:'cancelled'};return{};}
  if(name==='ai.none'){profile={kind:'none'};return profile;}
  if(name==='workspace.setupStatus')return{...workspace,completed};
  if(name==='workspace.configure'){workspace={...workspace,deviceLabel:args.deviceLabel as string};return{deviceId:workspace.deviceId,userEntityId:workspace.userEntityId};}
  if(name==='workspace.finishSetup'){completed=true;return{};}
  throw new Error('Synthetic unavailable action');
 })as NonNullable<CoreTransport['administer']>;
 const transport:CoreTransport={administer,query:fn(async(name:string)=>name==='portfolio.board'?structuredClone(EMPTY_BOARD):[])as CoreTransport['query'],execute:fn(async()=>({ok:true as const,eventId:'synthetic-event',ops:[],raisedQuestionIds:[],suggestedAssertionIds:[]})),subscribe:async()=>()=>{},close:fn()};
 const platform:Platform={connectCore:fn(async()=>transport),setup:{status:fn(async()=>({configured:false,locations:[{id:'documents' as const,label:'In Documents',available:true},{id:'dropbox' as const,label:'In Dropbox',available:false},{id:'drive' as const,label:'In Google Drive',available:false}]})),choose:fn(async(_location,mode)=>({token:'synthetic-selection',directory:'Synthetic Documents/Fulcrum',cloud:false,mode})),open:fn(async(_token,label)=>{workspace={...workspace,deviceLabel:label};})}};
 return{transport,platform,administer,setHardware:(value:Partial<typeof hardware>)=>{hardware={...hardware,...value};},setWorkspace:(value:Partial<typeof workspace>)=>{workspace={...workspace,...value};}};
}
