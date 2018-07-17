/* eslint-disable no-param-reassign */
import htmlTagsVoids from 'html-tags/void';
import * as esprima from 'esprima';
import isBooleanAttr from './utils/is-boolean-attr';

import {
  attributeName,
  conditionName,
  elementName,
  interpolationEscapedName,
  iterationName,
  mixinName,
  rootName,
  textName
} from './ast';

function codeGeneratorLiquid(
  node,
  { initialIndentLevel = 0, indentLevel = initialIndentLevel, replaceLocals = {} } = {}
) {
  switch (node.type) {
    case rootName:
      return node.children
        .map(child =>
          codeGeneratorLiquid(child, { initialIndentLevel, indentLevel, replaceLocals })
        )
        .join('');
    case mixinName:
      return node.children
        .map(child =>
          codeGeneratorLiquid(child, { initialIndentLevel, indentLevel, replaceLocals })
        )
        .join('');
    case elementName:
      return indent(
        generateTag(
          node.tagName,
          node.children
            .map(child =>
              codeGeneratorLiquid(child, {
                initialIndentLevel,
                indentLevel: indentLevel + 1,
                replaceLocals
              })
            )
            .join(''),
          node.attributes
            .map(child =>
              codeGeneratorLiquid(child, {
                initialIndentLevel,
                indentLevel: indentLevel + 1,
                replaceLocals
              })
            )
            .join('')
        ),
        {
          initialIndentLevel,
          indentLevel
        }
      );
    case textName:
      return node.value;
    case attributeName:
      return generateProperty(node.name, node.value, node.expression, replaceLocals);
    case interpolationEscapedName:
      return generateInterpolationEscaped(node.value, replaceLocals, true);
    case conditionName:
      return indent(
        generateCondition(
          node.test,
          codeGeneratorLiquid(node.consequent, {
            initialIndentLevel,
            indentLevel: indentLevel + 1,
            replaceLocals
          }),
          node.alternate &&
            codeGeneratorLiquid(node.alternate, {
              initialIndentLevel,
              indentLevel: indentLevel + 1,
              replaceLocals
            }),
          replaceLocals
        ),
        {
          initialIndentLevel,
          indentLevel
        }
      );
    case iterationName:
      return indent(
        generateIteration({
          iterable: node.iterable,
          currentValue: node.currentValue,
          body: codeGeneratorLiquid(node.body, {
            initialIndentLevel,
            indentLevel: indentLevel + 1,
            replaceLocals: {
              [node.index]: 'forloop.index0',
              [node.array]: node.iterable
            }
          })
        }),
        {
          initialIndentLevel,
          indentLevel
        }
      );
    default:
      throw new TypeError(node.type);
  }
}

export default codeGeneratorLiquid;

function generateTag(tagName, children, properties) {
  const startTagBeginning = `<${tagName}${properties}`;
  if (htmlTagsVoids.includes(tagName)) {
    return `${startTagBeginning} />`;
  }
  const startTag = `${startTagBeginning}>`;
  const endTag = `</${tagName}>`;
  const tag = startTag + children + endTag;

  return tag;
}

function generateProperty(name, value, expression, replaceLocals) {
  const normalizedName = normalizePropertyName(name);
  const startPropertyBeginning = ` ${normalizedName}`;

  if (value === true) {
    return startPropertyBeginning;
  }

  // NOTE: `value === true` is to accept boolean attributes, e.g.: `<input checked />`.
  if (!expression) {
    return `${startPropertyBeginning}="${value}"`;
  }

  const isBoolean = isBooleanAttr(name);
  // console.log('isBoolean attr', name, isBoolean);
  if (isBoolean) {
    // console.dir(value);
    const condition = generateCondition(value, normalizedName, undefined, replaceLocals);
    return ` ${condition}`;
  }

  return `${startPropertyBeginning}="${generateInterpolationEscaped(value, replaceLocals, true)}"`;
}

function normalizePropertyName(name) {
  switch (name) {
    case 'className':
      return 'class';
    case 'htmlFor':
      return 'for';
    case 'tabIndex':
      return 'tabindex';
    default:
      return name;
  }
}

function generateCondition(testExpression, consequent, alternate, replaceLocals) {
  if (typeof testExpression === 'string') {
    // console.dir(esprima);
    const parsed = esprima.parse(testExpression);
    if (parsed.body && parsed.body.length === 1 && parsed.body[0].type === 'ExpressionStatement') {
      testExpression = parsed.body[0].expression;
    } else {
      throw new Error(`unsupported test expression: ${expression}`);
    }
  }
  // const parsed = esprima.parse(test);
  let block = 'if';

  if (
    testExpression.type === 'UnaryExpression' &&
    testExpression.operator === '!' &&
    testExpression.argument &&
    testExpression.argument.type === 'Identifier'
  ) {
    testExpression = testExpression.argument;
    block = 'unless';
  }

  const testCondition = generateInterpolationEscaped(testExpression, replaceLocals, false);

  const conditionArray = [
    generateScriptlet(`${block} ${testCondition}`),
    consequent,
    alternate ? generateScriptlet('else') : null,
    alternate,
    generateScriptlet(`end${block}`)
  ].filter(Boolean);
  return conditionArray.join('');
}

function generateIteration({ iterable, currentValue, body }) {
  // const params = [currentValue, index, array].filter(Boolean).join(', ');
  const iterableParsed = esprima.parse(iterable);
  let initializator = '';

  if (
    iterableParsed.body &&
    iterableParsed.body[0] &&
    iterableParsed.body[0].type === 'ExpressionStatement' &&
    iterableParsed.body[0].expression.type === 'ArrayExpression' &&
    iterableParsed.body[0].expression.elements.every(e => e.type === 'Literal')
  ) {
    const joinedValues = iterableParsed.body[0].expression.elements.map(e => e.value).join('|');
    initializator = generateScriptlet(`assign iterator = "${joinedValues}" | split: '|'`);
    iterable = 'iterator';
  }

  const iterationArray = [
    initializator,
    generateScriptlet(`for ${currentValue} in ${iterable}`),
    body,
    generateScriptlet('endfor')
  ].filter(Boolean);
  return iterationArray.join('');
}

function generateScriptlet(value) {
  return `{% ${value} %}`;
}

const methodToFilter = {
  join: 'join',
  toUpperCase: 'upcase',
  toLowerCase: 'downcase',
  replace: 'replace',
  trim: 'strip',
  // slice defaults to 1.
  charAt: 'slice',
  // javascript "slice" is different to liquid "slice"
  substr: 'slice',

  // special case, we change the second argument
  slice: 'slice'
};

const propertyTranslation = {
  length: 'size'
};

/**
 *
 * @param {String|esprima.expression} expression the expression to interpolate
 * @param {Object} replaceLocals A key-value map of variables to replace name. Used in the for-each case.
 * @param {boolean} final indicates if the expression needs to be wrapped
 */
function generateInterpolationEscaped(expression, replaceLocals, final) {
  if (typeof expression === 'string') {
    // console.dir(esprima);
    const parsed = esprima.parse(expression);
    if (parsed.body && parsed.body.length === 1 && parsed.body[0].type === 'ExpressionStatement') {
      expression = parsed.body[0].expression;
    } else {
      throw new Error(`unsupported expression: ${expression}`);
    }
  }

  const wrap = v => (final ? `{{ ${v} }}` : v);

  switch (expression.type) {
    case 'Literal':
      if (!final && expression.raw.indexOf("'") === 0) {
        return `"${expression.value}"`;
      }
      return final ? expression.value : expression.raw;
    case 'Identifier':
      return wrap(replaceLocals[expression.name] || expression.name);
    case 'MemberExpression': {
      const left = generateInterpolationEscaped(expression.object, replaceLocals, false);
      const property =
        (expression.property.type === 'Literal' && propertyTranslation[expression.property.name]) ||
        expression.property;
      const right = generateInterpolationEscaped(property, {}, false);
      return wrap(`${left}.${right}`);
    }
    case 'BinaryExpression': {
      const finalLeafs = expression.operator !== '-';
      const left = generateInterpolationEscaped(expression.left, replaceLocals, finalLeafs);
      const right = generateInterpolationEscaped(expression.right, replaceLocals, finalLeafs);
      if (!final) {
        throw new Error(
          `Unsupported BinaryExpression placed inside another expression between ${left} and ${right}`
        );
      }
      switch (expression.operator) {
        case '+': {
          return `${left}${right}`;
        }
        case '-': {
          return wrap(`${left} | minus: ${right}`);
        }
        default:
          throw new Error(`Unsupported binary expression ${expression.operator}`);
      }
    }
    case 'CallExpression': {
      if (
        expression.callee.type !== 'MemberExpression' ||
        !expression.callee.property ||
        !methodToFilter[expression.callee.property.name]
      ) {
        const shown =
          (expression.callee.property && expression.callee.property.name) || expression.callee.name;
        throw new Error(`Unsupported CallExpression "${shown}"`);
      }

      const object = generateInterpolationEscaped(expression.callee.object, replaceLocals, false);

      // re-consider this
      // if (!final) {
      //   throw new Error(`Unsupported CallExpression inside another expression ${object}`);
      // }

      const jsMethod = expression.callee.property.name;
      const filterName = methodToFilter[jsMethod];
      if (expression.arguments.length === 0) {
        return wrap(`${object} | ${filterName}`);
      }

      if (jsMethod === 'slice') {
        formatSliceArguments(expression, object);
      }

      const args = expression.arguments
        .map(arg => generateInterpolationEscaped(arg, replaceLocals, false))
        .join(', ');

      return wrap(`${object} | ${filterName}: ${args}`);
    }
    case 'LogicalExpression': {
      let operator;
      switch (expression.operator) {
        case '&&':
          operator = 'and';
          break;
        case '||':
          operator = 'or';
          break;
        default:
          throw new Error(`unsupported logic operand ${expression.operator}`);
      }
      // liquid does not support parenthesis for operator precedence.
      // something like a && (b || c) needs to be expressed in nested ifs.
      const supportedTypes = ['Identifier', 'Literal'];
      if (
        !supportedTypes.includes(expression.left.type) ||
        !supportedTypes.includes(expression.right.type)
      ) {
        throw new Error(
          `unsupported logic operation between ${expression.left.type} and ${expression.right.type}`
        );
      }
      const left = generateInterpolationEscaped(expression.left, replaceLocals, false);
      const right = generateInterpolationEscaped(expression.right, replaceLocals, false);
      return wrap(`${left} ${operator} ${right}`);
    }
    // case 'ArrayExpression': {
    //   if (!expression.elements.every(el => el.type === 'Literal')) {
    //     throw new Error(`unsupported ArrayExpression ${expression.elements.map(e => e.type).join(',')}`);
    //   }
    //   return expression.elements.map(e => e.value).join('|')
    // }
    case 'TemplateLiteral':
      return expression.quasis
        .map((q, index) => {
          if (q.tail) {
            return q.value.raw;
          }
          return `${q.value.raw}${generateInterpolationEscaped(
            expression.expressions[index],
            replaceLocals,
            true
          )}`;
        })
        .join('');
    case 'ConditionalExpression':
      return generateCondition(
        expression.test,
        generateInterpolationEscaped(expression.consequent, replaceLocals, true),
        expression.alternate &&
          generateInterpolationEscaped(expression.alternate, replaceLocals, true),
        replaceLocals
      );
    default:
      throw new Error(`unsupported expression ${expression.type}`);
  }
}

function formatSliceArguments(expression, object) {
  const args = expression.arguments;
  if (args.length === 2 && args[0].type === 'Literal' && args[1].type === 'Literal') {
    args[1].value -= args[0].value;
    args[1].raw = args[1].value.toString();
  } else if (
    args.length === 1 &&
    args[0].type === 'Literal' &&
    expression.callee.object.type === 'Identifier'
  ) {
    args.push(`${object}.size`);
  } else {
    throw new Error(
      'Unsupported case of "slice" method. Note: slice is different in liquid than in js'
    );
  }
}

function indent(str, { initialIndentLevel, indentLevel }) {
  const indentChar = ' ';
  const indentLength = 2;
  const startIndentNumber = indentLevel * indentLength;
  const endIndentNumber = (indentLevel ? indentLevel - 1 : indentLevel) * indentLength;
  const strIndented = `${indentLevel === initialIndentLevel ? '' : '\n'}${indentChar.repeat(
    startIndentNumber
  )}${str}${'\n'}${indentChar.repeat(endIndentNumber)}`;
  return strIndented;
}
