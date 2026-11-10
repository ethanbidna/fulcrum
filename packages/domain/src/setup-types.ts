export interface ModelChoice {
  id:string; name:string; kind:'local'|'hosted'; model:string;
  license:string; licenseUrl:string; priceLabel?:string; developer:string; developerCountry:string|null;
  baseDeveloper:string; baseDeveloperCountry:string|null; originSource:string;
  processingLocation:string; dataPolicyUrl:string; downloadBytes:number|null;
  memoryBytes:number|null; diskRequiredBytes:number|null; validation:string;
}
export interface OriginPreference {homeCountry:string;domesticOnly:boolean;excludedCountries:string[];search:string}
export function filterModelChoices(choices:ModelChoice[],preference:OriginPreference):ModelChoice[]{
  const search=preference.search.trim().toLocaleLowerCase();
  return choices.filter(choice=>{
    const countries=[choice.developerCountry,choice.baseDeveloperCountry];
    if(preference.domesticOnly&&(!preference.homeCountry||countries.some(country=>country!==preference.homeCountry)))return false;
    if(countries.some(country=>country!==null&&preference.excludedCountries.includes(country)))return false;
    return !search||`${choice.name} ${choice.kind} ${choice.developer} ${choice.license} ${choice.processingLocation}`.toLocaleLowerCase().includes(search);
  });
}
export interface HardwareProfile {architecture:'intel'|'apple_silicon'|'unsupported';availableMemoryBytes:number;totalMemoryBytes:number;availableDiskBytes:number|null;runtimeSupported:boolean;runtimeReason:string|null}
export interface CompatibilityResult {structuredOutput:boolean;latencyMs:number;processRssBytes:number;modelResidentBytes:number|null;slow:boolean;at:string}
export interface AiProfile {kind:'none'|'local'|'hosted';choiceId?:string;digest?:string;revision?:string;compatibility?:CompatibilityResult;initiativeIds?:string[];dailyTokenBudget?:number}
export interface AiSetupStatus {hardware:HardwareProfile;choices:ModelChoice[];profile:AiProfile;suggestionId:string|null;runtimeDownloadBytes:number;runtimeVersion:string;hostedSupported:boolean;preference:OriginPreference;job?:{id:string;state:AiJob}}
export type AiJob = {phase:'running';message:string;completedBytes:number|null;totalBytes:number|null}|{phase:'ready';profile:AiProfile}|{phase:'failed';message:string}|{phase:'cancelled'};
export interface WorkspaceSelection {token:string;directory:string;cloud:boolean;mode:'create'|'open'}
export interface StartupStatus {configured:boolean;locations:{id:'documents'|'dropbox'|'drive';label:string;available:boolean}[]}
