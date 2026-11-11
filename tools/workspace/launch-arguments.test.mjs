import{expect,test}from'vitest';import{parseCoreArguments}from'../../apps/core/src/launch-arguments.ts';
const USER='08000000-0000-7000-8000-000000000001';
test('trusted launcher treats a Mac name resembling an option as data',()=>{expect(parseCoreArguments(['--workspace','/synthetic/Workspace $(literal)','--user-entity',USER,'--device-label','--create'])).toEqual({workspaceDirectory:'/synthetic/Workspace $(literal)',userEntityId:USER,deviceLabel:'--create',create:false});});
test('launcher rejects unknown, duplicate and missing configuration without guessing flags',()=>{for(const args of [[],['--workspace'],['--unknown'],['--workspace','/synthetic','--workspace','/other'],['--create','--create']])expect(()=>parseCoreArguments(args)).toThrow();});
