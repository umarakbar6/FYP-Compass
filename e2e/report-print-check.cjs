const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {chromium}=createRequire(path.join(process.cwd(),'package.json'))('@playwright/test');
(async()=>{
 const origin=process.env.FYP_LOCAL_WEB_URL||'http://127.0.0.1:5182',api=process.env.FYP_LOCAL_API_URL||'http://127.0.0.1:54329';
 for(const target of [origin,api]){const url=new URL(target);assert.equal(url.protocol,'http:');assert(['127.0.0.1','localhost'].includes(url.hostname));}
 const crypto=require('node:crypto');const fingerprint=()=>crypto.createHash('sha256').update(['src/operations/ReportExplorer.tsx','src/core/CorePages.tsx','src/assessment/assessment.css'].map(name=>fs.readFileSync(path.join(process.cwd(),name))).join('')).digest('hex');const implementation=fingerprint();
 const directory=await(await fetch(api+'/local-demo/accounts')).json();assert(directory.local_only);
 const coordinator=directory.accounts.find(a=>a.role==='coordinator');assert(coordinator);
 const browser=await chromium.launch({headless:true});
 const report={checkedAt:new Date().toISOString(),syntheticOnly:true,projectFolder:process.cwd(),reportImplementationSha256:implementation,checks:[]};
 try{
  const page=await browser.newPage({viewport:{width:1366,height:900}});page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(120000);
  const runtime=[];page.on('pageerror',e=>runtime.push(e.message));
  page.on('response',r=>{if(r.url().includes('/rest/')&&r.status()>=400)console.log(JSON.stringify({failedUrl:r.url(),status:r.status()}));});
  await page.goto(origin+'/login');
  await page.getByLabel('Demo account',{exact:true}).selectOption(coordinator.id);
  await page.getByRole('button',{name:'Enter local backend demo',exact:true}).click();
  await page.waitForURL('**/coordinator/dashboard');
  await page.goto(origin+'/coordinator/reports');
  await page.getByRole('link',{name:'Open full printable report',exact:true}).click();
  await page.waitForURL('**/coordinator/reports?view=full&session=*');
  await page.getByRole('heading',{name:'Accreditation report',exact:true}).waitFor();
  await page.waitForLoadState('networkidle',{timeout:45000}).catch(()=>{});
  await page.getByRole('heading',{level:3,name:/FYP Compass Synthetic Demo Project/}).waitFor();
  const body=await page.locator('body').innerText();
  for(const name of ['Student One','Student Two','Student Three'])assert(body.includes(name));
  for(const value of [91,86,82])assert(body.includes(value+'/100'),'Missing expected total '+value);
  report.checks.push({name:'Accreditation UI contains the synthetic project and all three SQL result totals',passed:true});
  await page.evaluate(()=>window.addEventListener('beforeprint',()=>{window.__auditPrinted=true;}));
  await page.getByRole('button',{name:'Print / save PDF',exact:true}).click();
  await page.waitForFunction(()=>window.__auditPrinted===true);
  report.checks.push({name:'Real print button fires the browser print lifecycle',passed:true});
  const output=path.join(process.cwd(),'handover/verification/strict-audit/sample-accreditation.pdf');fs.mkdirSync(path.dirname(output),{recursive:true});
  await page.pdf({path:output,format:'A4',printBackground:true,preferCSSPageSize:true,margin:{top:'14mm',bottom:'14mm',left:'12mm',right:'12mm'}});
  assert.equal(runtime.length,0);assert(fs.statSync(output).size>10000);
  report.checks.push({name:'Browser exports a nonempty printable PDF with no runtime errors',passed:true});
  assert.equal(fingerprint(),implementation,'Report source changed during the print test');report.pdf=output;report.bytes=fs.statSync(output).size;report.passed=true;
 }catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
 finally{await browser.close();fs.writeFileSync(path.join(process.cwd(),'handover/verification/strict-audit/report-print.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
})().catch(error=>{console.error(error.name);process.exitCode=1;});
