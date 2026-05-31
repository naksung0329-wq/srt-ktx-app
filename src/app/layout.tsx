import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RailPick — KTX/SRT 자동 예매",
  description: "KTX·SRT 매진 표 자동 예약 매크로 + 텔레그램 알림",
};

// FOUC 방지 — body 렌더 전에 localStorage에서 테마 읽어 data-theme 적용
const themeInitScript = `
(function(){try{var t=localStorage.getItem('rail-theme-v1');
if(t==='mocha'||t==='dusk'||t==='cherry'||t==='light'){document.documentElement.setAttribute('data-theme',t);}
else{document.documentElement.setAttribute('data-theme','light');}}catch(e){}
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ko"
      data-theme="light"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
