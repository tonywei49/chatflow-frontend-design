import type { PromptVariable, UnsupportedPromptVariable, UserInputFormItem } from '@/types/app'

export function replaceVarWithValues(str: string, promptVariables: PromptVariable[], inputs: Record<string, any>) {
  return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const name = inputs[key]
    if (name)
      return name

    const valueObj: PromptVariable | undefined = promptVariables.find(v => v.key === key)
    return valueObj ? `{{${valueObj.key}}}` : match
  })
}

export const userInputsFormToPromptVariables = (useInputs: UserInputFormItem[] | null) => {
  if (!useInputs)
    return []
  const promptVariables: PromptVariable[] = []
  useInputs.forEach((item: any) => {
    const isParagraph = !!item.paragraph
    const [type, content] = (() => {
      if (isParagraph)
        return ['paragraph', item.paragraph]

      if (item['text-input'])
        return ['string', item['text-input']]

      if (item.number)
        return ['number', item.number]

      return ['select', item.select]
    })()
    if (type === 'string' || type === 'paragraph') {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type,
        max_length: content.max_length,
        options: [],
      })
    }
    else if (type === 'number') {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type,
        options: [],
      })
    }
    else {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type: 'select',
        options: content.options,
      })
    }
  })
  return promptVariables
}

export const inspectUserInputsForm = (useInputs: UserInputFormItem[] | null) => {
  if (!useInputs) {
    return {
      promptVariables: [] as PromptVariable[],
      unsupportedVariables: [] as UnsupportedPromptVariable[],
    }
  }

  const promptVariables: PromptVariable[] = []
  const unsupportedVariables: UnsupportedPromptVariable[] = []

  useInputs.forEach((item: Record<string, any>) => {
    const keys = Object.keys(item || {})
    const type = keys[0]
    const content = type ? item[type] : undefined
    const label = content?.label || content?.variable || 'Unnamed field'
    const variable = content?.variable || label

    if (type === 'text-input') {
      promptVariables.push({
        key: variable,
        name: label,
        required: content.required,
        type: 'string',
        default: content.default,
        max_length: content.max_length,
        options: [],
      })
      return
    }

    if (type === 'paragraph') {
      promptVariables.push({
        key: variable,
        name: label,
        required: content.required,
        type: 'paragraph',
        default: content.default,
        max_length: content.max_length,
        options: [],
      })
      return
    }

    if (type === 'number') {
      promptVariables.push({
        key: variable,
        name: label,
        required: content.required,
        type: 'number',
        default: content.default,
        options: [],
      })
      return
    }

    if (type === 'select') {
      promptVariables.push({
        key: variable,
        name: label,
        required: content.required,
        type: 'select',
        default: content.default,
        options: content.options || [],
      })
      return
    }

    unsupportedVariables.push({
      key: variable,
      name: label,
      type: type || 'unknown',
    })
  })

  return {
    promptVariables,
    unsupportedVariables,
  }
}

export const createPromptInputDefaults = (promptVariables: PromptVariable[]) => {
  return promptVariables.reduce<Record<string, string | number>>((acc, item) => {
    if (item.default !== undefined && item.default !== null) {
      acc[item.key] = item.default
      return acc
    }

    acc[item.key] = ''
    return acc
  }, {})
}
