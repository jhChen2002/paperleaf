import LibraryApp from '../components/LibraryApp';
import {getCurrentUser} from '../lib/identity';
import {redirect} from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Home() {
  if(!await getCurrentUser())redirect('/login');
  return <LibraryApp />;
}
