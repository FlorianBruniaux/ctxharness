const {chromium}=require(process.env.PLAYWRIGHT_MODULE)
const path=require('node:path')
;(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
 try {
  for(const [theme,width] of [['light',1440],['dark',1440],['light',390]]) {
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme})
   await context.addInitScript(t=>localStorage.setItem('ctxharness.theme',t),theme)
   const p=await context.newPage();await p.goto(process.env.BASE,{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready)
   const take=(name)=>path.join(process.env.OUT,`${name}-${width}-${theme}.png`)
   await p.screenshot({path:take('hero')})
   await p.locator('footer').screenshot({path:take('footer')})
   await p.locator('.process-figure').screenshot({path:take('workflow')})
   await p.locator('.evidence-figure').screenshot({path:take('evidence')})
   await p.evaluate(()=>scrollTo(0,0));await p.locator('.theme-picker > summary').click()
   await p.screenshot({path:take('theme-menu')})
   if(width===390){await p.locator('.theme-picker > summary').click();await p.locator('#menu-toggle').click();await p.screenshot({path:take('navigation-menu')})}
   await context.close()
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
