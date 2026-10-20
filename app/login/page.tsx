import LoginForm from '../../components/LoginForm';
import {getChatGPTUser} from '../chatgpt-auth';
import './login.css';
export const dynamic='force-dynamic';
export default async function Login(){const legacy=await getChatGPTUser();return <LoginForm legacy={legacy?{name:legacy.displayName,email:legacy.email}:null}/>;}
