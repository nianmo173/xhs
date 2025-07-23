/**
 * AI交互管理模块
 * 提供重试机制、错误恢复和响应验证
 */

import OpenAI from 'openai';
import { getEnvVar, safeJsonParse } from './utils';
import { CONFIG } from './constants';
import { BusinessError } from './error-handler';

// 调试日志控制
const debugLoggingEnabled = process.env.ENABLE_DEBUG_LOGGING === 'true';

/**
 * AI响应验证结果
 */
interface ValidationResult {
  isValid: boolean;
  data: any;
  errors: string[];
}

/**
 * 重试配置
 */
interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // 基础延迟（毫秒）
  maxDelay: number; // 最大延迟（毫秒）
  backoffMultiplier: number; // 退避倍数
}

/**
 * AI客户端管理器
 */
export class AIManager {
  private client: OpenAI | null = null;
  private retryConfig: RetryConfig = {
    maxRetries: 2,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2
  };

  /**
   * 解析模型列表，支持多模型降级
   */
  private getModelList(): string[] {
    const modelNames = getEnvVar('AI_MODEL_NAME', CONFIG.DEFAULT_AI_MODEL);
    return modelNames.split(',').map(name => name.trim()).filter(name => name.length > 0);
  }

  /**
   * 获取AI客户端实例
   */
  private getClient(): OpenAI {
    if (!this.client) {
      const apiUrl = getEnvVar('THIRD_PARTY_API_URL');
      const apiKey = getEnvVar('THIRD_PARTY_API_KEY');
      
      if (!apiUrl || !apiKey) {
        throw new BusinessError(
          'AI服务配置不完整',
          'AI服务配置错误',
          '请检查环境变量配置，确保API地址和密钥正确设置',
          false
        );
      }
      
      this.client = new OpenAI({
        baseURL: apiUrl,
        apiKey: apiKey,
      });
    }
    
    return this.client;
  }

  /**
   * 计算重试延迟时间
   */
  private calculateDelay(attempt: number): number {
    const delay = this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 验证JSON响应
   */
  private validateJsonResponse(content: string, expectedFields: string[] = []): ValidationResult {
    const errors: string[] = [];

    if (!content || content.trim() === '') {
      errors.push('AI返回了空响应');
      return { isValid: false, data: null, errors };
    }

    if (debugLoggingEnabled) {
      console.log(`🔍 AI响应内容长度: ${content.length} 字符`);
      console.log(`🔍 AI响应前100字符: ${content.substring(0, 100)}...`);
    }

    const parsed: any = safeJsonParse(content, null);
    if (parsed === null) {
      errors.push('AI返回的不是有效的JSON格式');
      console.error('❌ JSON解析失败，原始内容:', content);
      return { isValid: false, data: null, errors };
    }

    if (debugLoggingEnabled) {
      console.log(`✅ JSON解析成功，包含字段: ${Object.keys(parsed).join(', ')}`);
    }

    for (const field of expectedFields) {
      if (!(field in parsed) || !parsed[field]) {
        errors.push(`缺少必需字段: ${field}`);
      }
    }
    if (expectedFields.includes('rules')) {
      if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
        errors.push('rules字段应该是非空数组');
      } else if (debugLoggingEnabled) {
        console.log(`✅ rules数组包含 ${parsed.rules.length} 个规律`);
      }
    }
    if (expectedFields.includes('titleFormulas')) {
      this.validateTitleFormulas(parsed.titleFormulas, errors);
    }
    if (expectedFields.includes('contentStructure')) {
      this.validateContentStructure(parsed.contentStructure, errors);
    }
    if (expectedFields.includes('tagStrategy')) {
      this.validateTagStrategy(parsed.tagStrategy, errors);
    }
    if (expectedFields.includes('coverStyleAnalysis')) {
      this.validateCoverStyleAnalysis(parsed.coverStyleAnalysis, errors);
    }

    return {
      isValid: errors.length === 0,
      data: parsed,
      errors
    };
  }

  private validateTitleFormulas(titleFormulas: any, errors: string[]): void {
    if (!titleFormulas || typeof titleFormulas !== 'object') {
      errors.push('titleFormulas字段缺失或格式错误');
      return;
    }
    if (!Array.isArray(titleFormulas.suggestedFormulas) || titleFormulas.suggestedFormulas.length === 0) {
      errors.push('titleFormulas.suggestedFormulas应该是非空数组');
    } else if (debugLoggingEnabled) {
      console.log(`✅ 标题公式包含 ${titleFormulas.suggestedFormulas.length} 个公式`);
    }
    if (!Array.isArray(titleFormulas.commonKeywords)) {
      errors.push('titleFormulas.commonKeywords应该是数组');
    }
  }

  private validateContentStructure(contentStructure: any, errors: string[]): void {
    if (!contentStructure || typeof contentStructure !== 'object') {
      errors.push('contentStructure字段缺失或格式错误');
      return;
    }
    if (!Array.isArray(contentStructure.openingHooks) || contentStructure.openingHooks.length === 0) {
      errors.push('contentStructure.openingHooks应该是非空数组');
    }
    if (!Array.isArray(contentStructure.endingHooks) || contentStructure.endingHooks.length === 0) {
      errors.push('contentStructure.endingHooks应该是非空数组');
    }
    if (!contentStructure.bodyTemplate || typeof contentStructure.bodyTemplate !== 'string') {
      errors.push('contentStructure.bodyTemplate应该是字符串');
    }
    if (debugLoggingEnabled) {
      console.log(`✅ 内容结构验证通过：${contentStructure.openingHooks?.length || 0}个开头，${contentStructure.endingHooks?.length || 0}个结尾`);
    }
  }

  private validateTagStrategy(tagStrategy: any, errors: string[]): void {
    if (!tagStrategy || typeof tagStrategy !== 'object') {
      errors.push('tagStrategy字段缺失或格式错误');
      return;
    }
    if (debugLoggingEnabled) {
      console.log(`🔍 tagStrategy结构:`, JSON.stringify(tagStrategy, null, 2));
    }
    if (!tagStrategy.commonTags) {
      if (debugLoggingEnabled) {
        console.log(`⚠️ commonTags字段不存在，尝试从其他字段提取`);
      }
      if (tagStrategy.tagCategories) {
        const extractedTags = [];
        if (Array.isArray(tagStrategy.tagCategories.coreKeywords)) {
          extractedTags.push(...tagStrategy.tagCategories.coreKeywords);
        }
        if (Array.isArray(tagStrategy.tagCategories.longTailKeywords)) {
          extractedTags.push(...tagStrategy.tagCategories.longTailKeywords);
        }
        tagStrategy.commonTags = extractedTags.slice(0, 10);
        if (debugLoggingEnabled) {
          console.log(`🔧 自动生成commonTags:`, tagStrategy.commonTags);
        }
      } else {
        tagStrategy.commonTags = [];
      }
    } else if (!Array.isArray(tagStrategy.commonTags)) {
      if (debugLoggingEnabled) {
        console.log(`⚠️ commonTags不是数组，类型为:`, typeof tagStrategy.commonTags);
        console.log(`⚠️ commonTags内容:`, tagStrategy.commonTags);
      }
      errors.push('tagStrategy.commonTags应该是数组');
    }
    if (debugLoggingEnabled) {
      console.log(`✅ 标签策略验证通过：${tagStrategy.commonTags?.length || 0}个常用标签`);
    }
  }

  private validateCoverStyleAnalysis(coverStyleAnalysis: any, errors: string[]): void {
    if (!coverStyleAnalysis || typeof coverStyleAnalysis !== 'object') {
      errors.push('coverStyleAnalysis字段缺失或格式错误');
      return;
    }
    if (!Array.isArray(coverStyleAnalysis.commonStyles) || coverStyleAnalysis.commonStyles.length === 0) {
      errors.push('coverStyleAnalysis.commonStyles应该是非空数组');
    }
    if (debugLoggingEnabled) {
      console.log(`✅ 封面风格分析验证通过：${coverStyleAnalysis.commonStyles?.length || 0}个风格`);
    }
  }

  /**
   * 带重试的AI分析调用（支持多模型降级）
   */
  async analyzeWithRetry(
    prompt: string,
    expectedFields: string[] = ['titleFormulas', 'contentStructure', 'tagStrategy', 'coverStyleAnalysis']
  ): Promise<any> {
    const modelList = this.getModelList();
    let lastError: Error | null = null;

    for (let modelIndex = 0; modelIndex < modelList.length; modelIndex++) {
      const currentModel = modelList[modelIndex];

      for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
        try {
          if (debugLoggingEnabled) {
            console.log(`🤖 AI分析尝试 ${attempt + 1}/${this.retryConfig.maxRetries + 1} (模型: ${currentModel})`);
          }

          const client = this.getClient();

          const requestParams: any = {
            model: currentModel,
            messages: [{ role: "user", content: prompt }],
            temperature: CONFIG.TEMPERATURE,
          };

          if (!currentModel.toLowerCase().includes('gemini')) {
            requestParams.response_format = { type: "json_object" };
          }

          const response: any = await client.chat.completions.create(requestParams);
          
          let content: string = '';

          // --- [终极核心修复] ---
          // 检查并处理各种可能的代理响应格式
          if (Array.isArray(response)) {
            // 情况1：代理返回了字符数组，如 ['{', '"', 'a',...]}
            if (debugLoggingEnabled) {
              console.log('🔧 检测到AI响应为数组格式，正在合并为字符串...');
            }
            content = response.join('');
          } else if (typeof response === 'string') {
            // 情况2：代理直接返回了字符串
            if (debugLoggingEnabled) {
              console.log('🔧 检测到AI响应为原生字符串格式。');
            }
            content = response;
          } else if (response && response.choices && response.choices.length > 0) {
            // 情况3：标准的OpenAI响应格式
            if (debugLoggingEnabled) {
              console.log('🔧 检测到AI响应为标准OpenAI对象格式。');
            }
            content = response.choices[0]?.message?.content || '';
          }
          // --- [修复结束] ---

          // 对最终提取的 content 进行非空验证
          if (!content || content.trim() === '') {
            console.error('❌ AI响应在所有格式检查后仍为空或无效');
            // 在调试模式下打印原始响应以供分析
            if (debugLoggingEnabled) {
                console.error('📄 原始响应的完整内容:', JSON.stringify(response, null, 2));
            }
            throw new Error('AI返回了空内容或无法识别的响应格式');
          }

          // 验证JSON内容
          const validation = this.validateJsonResponse(content, expectedFields);
          if (!validation.isValid) {
            throw new Error(`AI响应验证失败: ${validation.errors.join(', ')}`);
          }

          if (debugLoggingEnabled) {
            console.log(`✅ AI分析成功 (模型: ${currentModel})`);
          }
          return validation.data;

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (debugLoggingEnabled) {
            console.warn(`⚠️ 模型 ${currentModel} 尝试 ${attempt + 1} 失败:`, lastError.message);
          }
          if (attempt < this.retryConfig.maxRetries) {
            const delayMs = this.calculateDelay(attempt);
            if (debugLoggingEnabled) {
              console.log(`⏳ 等待 ${delayMs}ms 后重试...`);
            }
            await this.delay(delayMs);
          }
        }
      }

      if (modelIndex < modelList.length - 1) {
        if (debugLoggingEnabled) {
          console.log(`🔄 模型 ${currentModel} 失败，尝试下一个模型: ${modelList[modelIndex + 1]}`);
        }
      }
    }

    throw new BusinessError(
      `AI分析失败，已尝试所有模型 [${modelList.join(', ')}]，每个模型重试${this.retryConfig.maxRetries}次: ${lastError?.message}`,
      'AI分析失败',
      '请稍后重试，如果问题持续请联系技术支持',
      true
    );
  }

  /**
   * 带重试的流式生成调用（支持多模型降级）
   */
  async generateStreamWithRetry(
    prompt: string,
    onChunk: (content: string) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    const modelList = this.getModelList();
    let lastError: Error | null = null;

    for (let modelIndex = 0; modelIndex < modelList.length; modelIndex++) {
      const currentModel = modelList[modelIndex];

      for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
        try {
          if (debugLoggingEnabled) {
            console.log(`🤖 流式生成尝试 ${attempt + 1}/${this.retryConfig.maxRetries + 1} (模型: ${currentModel})`);
          }

          const client = this.getClient();
          const stream = await client.chat.completions.create({
            model: currentModel,
            messages: [{ role: "user", content: prompt }],
            stream: true,
            temperature: CONFIG.TEMPERATURE,
          });

          let hasContent = false;
          for await (const chunk of stream) {
            let content = '';
            // 同时处理标准格式和代理可能返回的纯字符串块
            if (chunk && chunk.choices && chunk.choices.length > 0) {
              content = chunk.choices[0]?.delta?.content || '';
            } 
            else if (typeof chunk === 'string') {
              content = chunk;
            } else if (debugLoggingEnabled) {
              console.warn('⚠️ 收到了未知格式的流式块，已忽略:', chunk);
            }

            if (content) {
              hasContent = true;
              onChunk(content);
            }
          }

          if (!hasContent) {
            throw new Error('AI流式响应未返回任何内容');
          }

          if (debugLoggingEnabled) {
            console.log(`✅ 流式生成成功 (模型: ${currentModel})`);
          }
          return;

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (debugLoggingEnabled) {
            console.warn(`⚠️ 模型 ${currentModel} 流式生成尝试 ${attempt + 1} 失败:`, lastError.message);
          }
          if (attempt < this.retryConfig.maxRetries) {
            const delayMs = this.calculateDelay(attempt);
            if (debugLoggingEnabled) {
              console.log(`⏳ 等待 ${delayMs}ms 后重试...`);
            }
            await this.delay(delayMs);
          }
        }
      }

      if (modelIndex < modelList.length - 1) {
        if (debugLoggingEnabled) {
          console.log(`🔄 模型 ${currentModel} 失败，尝试下一个模型: ${modelList[modelIndex + 1]}`);
        }
      }
    }

    const finalError = new BusinessError(
      `流式生成失败，已尝试所有模型 [${modelList.join(', ')}]，每个模型重试${this.retryConfig.maxRetries}次: ${lastError?.message}`,
      '内容生成失败',
      '请稍后重试，如果问题持续请联系技术支持',
      true
    );

    onError(finalError);
  }

  /**
   * 设置重试配置
   */
  setRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
  }

  /**
   * 重置客户端（用于配置更新后）
   */
  resetClient(): void {
    this.client = null;
  }
}

// 导出单例实例
export const aiManager = new AIManager();
