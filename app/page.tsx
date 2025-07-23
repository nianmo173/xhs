import Link from 'next/link'
import dynamic from 'next/dynamic'
import GeneratorClient from '@/components/GeneratorClient'
import FaqSection from '@/components/FaqSection'

// 动态导入作者卡片组件，减少首次加载的资源体积
const AuthorCard = dynamic(() => import('@/components/AuthorCard'), {
  loading: () => (
    <div className="bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-lg p-6 animate-pulse">
      <div className="flex flex-col items-center gap-4">
        <div className="h-6 bg-gray-200 rounded w-48"></div>
        <div className="h-4 bg-gray-200 rounded w-96"></div>
        <div className="h-4 bg-gray-200 rounded w-80"></div>
        <div className="h-12 bg-gray-200 rounded w-64"></div>
        <div className="h-3 bg-gray-200 rounded w-72"></div>
      </div>
    </div>
  ),
})

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

        {/* 作者信息区域 */}
        <div className="mt-12 text-center">
          <AuthorCard />
        </div>
      </div>
    </div>
  )
}
