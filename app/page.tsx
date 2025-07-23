import Link from 'next/link'
import FaqSection from '@/components/FaqSection'
import GeneratorClient from '@/components/GeneratorClient'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-red-50 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            🔥 AI小红书爆款文案生成器
          </h1>
          <p className="text-lg text-gray-600 mb-4">
            智能分析热门笔记，实时生成爆款文案
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            <Link
              href="/blog"
              className="inline-flex items-center px-4 py-2 text-sm text-purple-600 hover:text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors"
            >
              📚 写作攻略
            </Link>
          </div>
        </div>

        <GeneratorClient />

        {/* FAQ区域 */}
        <FaqSection />

        {/* 作者信息区域已被删除 */}
      </div>
    </div>
  )
}
 
