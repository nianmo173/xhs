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

/** AI响应验证结果 */
interface ValidationResult {
  isValid: boolean;
  data: any;
  errors: string[];
}

/** 重试配置 */
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/** AI客户端管理器 */
export class AIManager {
  private client: OpenAI | null = null;
  private retryConfig: RetryConfig = {
    maxRetries: 2,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2
  };

  private getModelList(): string[] {
    const modelNames = getEnvVar('AI_MODEL_NAME', CONFIG.DEFAULT_AI_MODEL);
    return modelNames.split(',').map(name => name.trim()).filter(name => name.length > 0);
  }

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

  private calculateDelay(attempt: number): number {
    const delay = this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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

    return { isValid: errors.length === 0, data: parsed, errors };
  }

  private validateTitleFormulas(titleFormulas: any, errors: string[]): void { if (!titleFormulas || typeof titleFormulas !== 'object') { errors.push('titleFormulas字段缺失或格式错误'); return; } if (!Array.isArray(titleFormulas.suggestedFormulas) || titleFormulas.suggestedFormulas.length === 0) { errors.push('titleFormulas.suggestedFormulas应该是非空数组'); } if (!Array.isArray(titleFormulas.commonKeywords)) { errors.push('titleFormulas.commonKeywords应该是数组'); } }
  private validateContentStructure(contentStructure: any, errors: string[]): void { if (!contentStructure || typeof contentStructure !== 'object') { errors.push('contentStructure字段缺失或格式错误'); return; } if (!Array.isArray(contentStructure.openingHooks) || contentStructure.openingHooks.length === 0) { errors.push('contentStructure.openingHooks应该是非空数组'); } if (!Array.isArray(contentStructure.endingHooks) || contentStructure.endingHooks.length === 0) { errors.push('contentStructure.endingHooks应该是非空数组'); } if (!contentStructure.bodyTemplate || typeof contentStructure.bodyTemplate !== 'string') { errors.push('contentStructure.bodyTemplate应该是字符串'); } }
  private validateTagStrategy(tagStrategy: any, errors: string[]): void { if (!tagStrategy || typeof tagStrategy !== 'object') { errors.push('tagStrategy字段缺失或格式错误'); return; } if (!tagStrategy.commonTags) { if (tagStrategy.tagCategories) { const extractedTags = []; if (Array.isArray(tagStrategy.tagCategories.coreKeywords)) { extractedTags.push(...tagStrategy.tagCategories.coreKeywords); } if (Array.isArray(tagStrategy.tagCategories.longTailKeywords)) { extractedTags.push(...tagStrategy.tagCategories.longTailKeywords); } tagStrategy.commonTags = extractedTags.slice(0, 10); } else { tagStrategy.commonTags = []; } } else if (!Array.isArray(tagStrategy.commonTags)) { errors.push('tagStrategy.commonTags应该是数组'); } }
  private validateCoverStyleAnalysis(coverStyleAnalysis: any, errors: string[]): void { if (!coverStyleAnalysis || typeof coverStyleAnalysis !== 'object') { errors.push('coverStyleAnalysis字段缺失或格式错误'); return; } if (!Array.isArray(coverStyleAnalysis.commonStyles) || coverStyleAnalysis.commonStyles.length === 0) { errors.push('coverStyleAnalysis.commonStyles应该是非空数组'); } }

  async analyzeWithRetry(
    prompt: string,
    expectedFields: string[] = ['titleFormulas', 'contentStructure', 'tagStrategy', 'coverStyleAnalysis']
  ): Promise<any> {
    const modelList = this.getModelList();
    let lastError: Error | null = null;
    let attemptCount = 0;

    for (const currentModel of modelList) {
      for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
        attemptCount++;
        try {
          if (debugLoggingEnabled) {
            console.log(`🤖 AI分析尝试 ${attempt + 1}/${this.retryConfig.maxRetries + 1} (模型: ${currentModel})`);
          }

          const client = this.getClient();
          const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
            model: currentModel,
            messages: [{ role: "user", content: prompt }],
            temperature: CONFIG.TEMPERATURE,
            stream: false,
          };
          if (!currentModel.toLowerCase().includes('gemini')) {
            requestParams.response_format = { type: "json_object" };
          }
          
          const response: any = await client.chat.completions.create(requestParams);
          
          let content: string = '';

          // --- [最终极修复：HTML响应检测] ---
          // 检查响应是否是HTML页面，这通常是配置错误（如URL错误、密钥错误）的标志
          if (typeof response === 'string' && (response.trim().toLowerCase().startsWith('<!doctype html') || response.trim().toLowerCase().startsWith('<html'))) {
              if (debugLoggingEnabled) {
                 console.error('❌ 检测到AI响应为HTML页面，这表明API配置可能错误！');
                 console.error('📄 HTML内容前500字符:', response.substring(0, 500));
              }
              // 直接抛出配置错误，不再重试，因为重试也无效
              throw new BusinessError(
                  'API返回了HTML页面，而不是预期的JSON。这通常是API URL或密钥配置错误导致的。',
                  'AI服务配置错误',
                  '请立即检查您的API地址（可能需要在末尾添加 /v1）和API密钥是否正确无误。',
                  false // 配置错误，不可重试
              );
          }
          // --- [修复结束] ---

          // 处理之前遇到的各种可能的代理响应格式
          if (Array.isArray(response)) {
            content = response.join('');
          } else if (typeof response === 'string') {
            content = response;
          } else if (response && response.choices && response.choices.length > 0) {
            content = response.choices[0]?.message?.content || '';
          }

          if (!content || content.trim() === '') {
            if (debugLoggingEnabled) {
                console.error('❌ AI响应在所有格式检查后仍为空或无效');
                console.error('📄 原始响应的完整内容:', JSON.stringify(response, null, 2));
            }
            throw new Error('AI返回了空内容或无法识别的响应格式');
          }

          const validation = this.validateJsonResponse(content, expectedFields);
          if (!validation.isValid) {
            throw new Error(`AI响应验证失败: ${validation.errors.join(', ')}`);
          }

          if (debugLoggingEnabled) console.log(`✅ AI分析成功 (模型: ${currentModel})`);
          return validation.data;

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          // 如果是配置错误，则立即中断循环
          if (error instanceof BusinessError && !error.canRetry) {
             throw error;
          }
          if (debugLoggingEnabled) console.warn(`⚠️ 模型 ${currentModel} 尝试 ${attempt + 1} 失败:`, lastError.message);
          if (attempt < this.retryConfig.maxRetries) {
            const delayMs = this.calculateDelay(attempt);
            if (debugLoggingEnabled) console.log(`⏳ 等待 ${delayMs}ms 后重试...`);
            await this.delay(delayMs);
          }
        }
      }
      if (modelList.length > 1) console.log(`🔄 模型 ${currentModel} 失败，尝试下一个模型...`);
    }

    throw new BusinessError(
      `AI分析失败，已尝试所有模型 [${modelList.join(', ')}]，总共尝试${attemptCount}次: ${lastError?.message}`,
      'AI分析失败',
      '请稍后重试，如果问题持续，请检查后台日志或联系技术支持。',
      true
    );
  }

  async generateStreamWithRetry(prompt: string, onChunk: (content: string) => void, onError: (error: Error) => void): Promise<void> {
     // ... [流式部分代码保持不变] ...
     const modelList = this.getModelList(); let lastError: Error | null = null; for (const currentModel of modelList) { for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) { try { if (debugLoggingEnabled) { console.log(`🤖 流式生成尝试 ${attempt + 1}/${this.retryConfig.maxRetries + 1} (模型: ${currentModel})`); } const client = this.getClient(); const stream = await client.chat.completions.create({ model: currentModel, messages: [{ role: "user", content: prompt }], stream: true, temperature: CONFIG.TEMPERATURE, }); let hasContent = false; for await (const chunk of stream) { let content = ''; if (chunk && chunk.choices && chunk.choices.length > 0) { content = chunk.choices[0]?.delta?.content || ''; } else if (typeof chunk === 'string') { content = chunk; } else if (debugLoggingEnabled) { console.warn('⚠️ 收到了未知格式的流式块，已忽略:', chunk); } if (content) { hasContent = true; onChunk(content); } } if (!hasContent) { throw new Error('AI流式响应未返回任何内容'); } if (debugLoggingEnabled) { console.log(`✅ 流式生成成功 (模型: ${currentModel})`); } return; } catch (error) { lastError = error instanceof Error ? error : new Error(String(error)); if (debugLoggingEnabled) { console.warn(`⚠️ 模型 ${currentModel} 流式生成尝试 ${attempt + 1} 失败:`, lastError.message); } if (attempt < this.retryConfig.maxRetries) { const delayMs = this.calculateDelay(attempt); if (debugLoggingEnabled) { console.log(`⏳ 等待 ${delayMs}ms 后重试...`); } await this.delay(delayMs); } } } if (modelList.length > 1) { if (debugLoggingEnabled) { console.log(`🔄 模型 ${currentModel} 失败，尝试下一个模型...`); } } } const finalError = new BusinessError( `流式生成失败，已尝试所有模型 [${modelList.join(', ')}]，每个模型重试${this.retryConfig.maxRetries}次: ${lastError?.message}`, '内容生成失败', '请稍后重试，如果问题持续请联系技术支持', true ); onError(finalError);
  }
  
  setRetryConfig(config: Partial<RetryConfig>): void { this.retryConfig = { ...this.retryConfig, ...config }; }
  resetClient(): void { this.client = null; }
}

export const aiManager = new AIManager();

