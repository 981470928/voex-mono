import type { AgentContext, AgentTool, ToolCall, ToolDefinition, ToolProperty } from './types';

function validateParameter(value: unknown, property: ToolProperty, path: string): void {
  const invalid = () => new Error(`参数类型不正确：${path}`);
  if (property.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const input = value as Record<string, unknown>;
    for (const name of property.required ?? [])
      if (!Object.hasOwn(input, name)) throw new Error(`缺少参数：${path}.${name}`);
    for (const [name, item] of Object.entries(input)) {
      const child = property.properties?.[name];
      if (!child || !Object.hasOwn(property.properties ?? {}, name))
        throw new Error(`不支持的参数：${path}.${name}`);
      validateParameter(item, child, `${path}.${name}`);
    }
    return;
  }
  if (property.type === 'array') {
    if (!Array.isArray(value)) throw invalid();
    if (property.minItems !== undefined && value.length < property.minItems)
      throw new Error(`参数 ${path} 至少需要 ${property.minItems} 项`);
    if (!property.items) throw new Error(`参数 ${path} 缺少数组元素定义`);
    value.forEach((item, index) => validateParameter(item, property.items!, `${path}[${index}]`));
    return;
  }
  if (property.type === 'integer' || property.type === 'number') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (property.type === 'integer' && !Number.isSafeInteger(value))
    )
      throw invalid();
    if (
      (property.minimum !== undefined && value < property.minimum) ||
      (property.maximum !== undefined && value > property.maximum)
    )
      throw new Error(`参数 ${path} 超出允许范围`);
    return;
  }
  if (typeof value !== property.type) throw invalid();
  if (property.enum && !property.enum.includes(String(value)))
    throw new Error(`参数值不正确：${path}`);
}

/** Registration is the only way to grant an Agent a host capability. No eval or arbitrary HTTP. */
export class AgentToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): () => void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) || this.tools.has(tool.name))
      throw new Error(`工具名称无效或重复：${tool.name}`);
    this.tools.set(tool.name, tool);
    return () => {
      if (this.tools.get(tool.name) === tool) this.tools.delete(tool.name);
    };
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values(), ({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  async execute(call: ToolCall, context: AgentContext): Promise<unknown> {
    context.signal.throwIfAborted();
    const tool = this.tools.get(call.name);
    if (!tool) throw new Error(`未注册该能力：${call.name}`);
    const input: unknown = JSON.parse(call.arguments);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('工具参数必须是 JSON 对象');
    validateParameter(input, tool.parameters, '参数');
    const args = input as Record<string, unknown>;
    return tool.execute(args, context);
  }
}
