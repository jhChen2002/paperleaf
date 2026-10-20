export async function getChatGPTUser(){return {userId:'local-owner',displayName:'我的本地文献库',email:'无需账号 · 数据保存在这台电脑',fullName:null};}
export async function getCurrentUser(){return {...await getChatGPTUser(),authType:'local',legacyAvailable:false,legacySignedIn:false};}
