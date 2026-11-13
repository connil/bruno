import React from 'react';
import { act, render } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import themes from 'themes';
import SingleLineEditor from './index';

jest.mock('utils/codemirror/autocomplete', () => ({ setupAutoComplete: () => () => {} }));
jest.mock('utils/codemirror/linkAware', () => ({ setupLinkAware: jest.fn() }));
jest.mock('utils/common/codemirror', () => ({ defineCodeMirrorBrunoVariablesMode: jest.fn() }));

const renderEditor = (props) => (
  <ThemeProvider theme={themes.light}>
    <SingleLineEditor {...props} />
  </ThemeProvider>
);

describe('SingleLineEditor controlled values', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    Range.prototype.getClientRects = () => [];
  });

  it('resets an edit normalized by the parent even when the value prop stays unchanged', () => {
    const onChange = jest.fn();
    const { container, rerender } = render(renderEditor({ value: 'https://example.com', onChange }));
    const editorElement = container.querySelector('.CodeMirror');
    const editor = editorElement.CodeMirror;

    act(() => editor.setValue('https://example.com?tag=new'));
    expect(onChange).toHaveBeenCalledWith('https://example.com?tag=new');
    rerender(renderEditor({ value: 'https://example.com', onChange }));

    expect(editor.getValue()).toBe('https://example.com');
    expect(editorElement).not.toHaveTextContent('tag=new');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null])('keeps an absent value empty across unrelated renders: %s', (value) => {
    const { container, rerender } = render(renderEditor({ value }));
    rerender(renderEditor({ value, placeholder: 'URL' }));

    expect(container.querySelector('.CodeMirror').CodeMirror.getValue()).toBe('');
  });
});
