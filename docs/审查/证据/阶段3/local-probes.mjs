// 隔离复现：仅写临时目录；断言用于证实当前缺陷，不是产品通过测试。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../../../../apps/api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../../../apps/api/src/app.factory.js';
import { writeJsonFileAtomically } from '../../../../apps/api/src/infrastructure/atomic-json-file.ts';
const results=[];
const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowra-review3-'));
function fixture(name){
 const dir=path.join(root,name); fs.mkdirSync(dir);
 let writes=0,failAt=Infinity;
 const file=path.join(dir,'data.json');
 const store=createFileDataStore(file,{writeJson:(p,d)=>{writes++; if(writes===failAt)throw new Error('injected write failure');writeJsonFileAtomically(p,d);}});
 const app=createAppContext({dataStore:store,storageRootDir:dir,uploadsDir:path.join(dir,'uploads'),ownerId:'review'});
 const h=app.http.knowledge;
 const spaceId=h.createDefaultKnowledgeSpace().id;
 return {h,store,file,spaceId,failAfter:(n)=>{failAt=writes+n;},disk:()=>JSON.parse(fs.readFileSync(file,'utf8'))};
}
try{
 {const f=fixture('failed-create');f.failAfter(1);
 assert.throws(()=>f.h.createFolder({id:'failed',spaceId:f.spaceId,name:'Failed'}),e=>e.code==='STORAGE_WRITE_FAILED');
 assert.equal(f.store.state.folders.length,1);assert.equal(f.disk().folders.length,0);
 f.h.createFolder({id:'ok',spaceId:f.spaceId,name:'OK'});
 assert.equal(f.disk().folders.length,2);
 results.push({id:'S3-01a',result:'confirmed',observation:'新建目录报错后内存保留记录；下次成功写入将失败记录一并落盘'});}
 {const f=fixture('subtree-delete');f.h.createFolder({id:'parent',spaceId:f.spaceId,name:'Parent'});f.h.createFolder({id:'child',spaceId:f.spaceId,name:'Child',parentId:'parent'});
 f.failAfter(2);assert.throws(()=>f.h.deleteFolder({id:'parent'}),e=>e.code==='STORAGE_WRITE_FAILED');
 assert.deepEqual(f.disk().folders.map(x=>x.id),['child']);
 assert.throws(()=>createFileDataStore(f.file));
 results.push({id:'S3-01b',result:'confirmed',observation:'删除子树第二次写入失败后，磁盘保留指向已删除父目录的子目录，重启校验拒绝加载'});}
 {const f=fixture('restore-name');f.h.createNote({id:'old',spaceId:f.spaceId,title:'Same',rawMarkdown:'old'});f.h.deleteNote({id:'old'});f.h.createNote({id:'new',spaceId:f.spaceId,title:'Same',rawMarkdown:'new'});f.h.restoreNote({id:'old'});
 assert.equal(f.store.state.notes.filter(x=>!x.deleted&&x.title==='Same').length,2);
 results.push({id:'S3-04',result:'confirmed',observation:'回收站恢复绕过同级重名检查，得到两篇同级同名有效笔记'});}
 {const f=fixture('group-id');f.h.createTagGroup({id:'group',spaceId:f.spaceId,name:'Original',selectionMode:'multiple'});f.h.createTag({id:'tag',spaceId:f.spaceId,name:'Tag',groupId:'group'});f.h.createTagGroup({id:'group',spaceId:f.spaceId,name:'Replacement',selectionMode:'single'});
 assert.equal(f.store.state.tagGroups.length,1);assert.equal(f.store.state.tagGroups[0].name,'Replacement');assert.equal(f.store.state.tagGroups[0].selectionMode,'single');
 results.push({id:'S3-05',result:'confirmed',observation:'创建分组重复 ID 直接覆盖原分组，绕过有标签时禁止切换单多选规则'});}
 console.log(JSON.stringify({node:process.version,kind:'isolated defect reproductions',results},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
