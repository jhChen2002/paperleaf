import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '纸间 Paperleaf · 让读过的知识，随时可寻',
  description: '私人的文献与阅读笔记空间。整理论文，记录灵感，在不同设备上继续阅读。',
  icons: {icon: '/favicon.svg', shortcut: '/favicon.svg'},
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
