import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { ThemeContext } from 'providers/Theme';
import { collectionsSlice } from 'providers/ReduxStore/slices/collections';
import themes from 'themes';
import QueryUrl from './index';

jest.mock('nanoid', () => {
  let id = 0;
  return { customAlphabet: () => () => `generated-${++id}` };
});

jest.mock('providers/ReduxStore/slices/collections/actions', () => ({
  saveRequest: jest.fn(),
  cancelRequest: jest.fn()
}));
jest.mock('components/Sidebar/Collections/Collection/CollectionItem/GenerateCodeItem/index', () => () => null);
jest.mock('./HttpMethodSelector', () => () => <span>GET</span>);
jest.mock('components/RequestPane/SendButton', () => () => <button>Send</button>);
jest.mock('components/ToolHint', () => ({ children }) => children);
jest.mock('utils/codemirror/autocomplete', () => ({ setupAutoComplete: () => () => {} }));
jest.mock('utils/codemirror/linkAware', () => ({ setupLinkAware: jest.fn() }));
jest.mock('utils/common/codemirror', () => ({ defineCodeMirrorBrunoVariablesMode: jest.fn() }));

const queryParams = [
  { uid: 'q1', name: 'tag', value: 'one', type: 'query', enabled: true, description: 'First tag' },
  { uid: 'q2', name: 'tag', value: 'two', type: 'query', enabled: true },
  { uid: 'q3', name: 'disabled', value: 'hidden', type: 'query', enabled: false }
];

const renderUrl = (type = 'http-request', hash = '') => {
  const item = {
    uid: 'request',
    type,
    request: {
      method: 'GET',
      url: `{{host}}/users/:id?tag=one&tag=two${hash}`,
      params: [...queryParams, { uid: 'path', name: 'id', value: '123', type: 'path', enabled: true }]
    }
  };
  const collection = {
    uid: 'collection',
    runtimeVariables: { host: 'https://example.com' },
    environments: [],
    items: [item]
  };
  const store = configureStore({
    reducer: { collections: collectionsSlice.reducer },
    preloadedState: { collections: { collections: [collection] } }
  });
  const ConnectedUrl = () => {
    const currentCollection = useSelector((state) => state.collections.collections[0]);
    return <QueryUrl item={currentCollection.items[0]} collection={currentCollection} handleRun={jest.fn()} />;
  };
  const result = render(
    <Provider store={store}>
      <ThemeContext.Provider value={{ theme: themes.light, storedTheme: 'light' }}>
        <ThemeProvider theme={themes.light}>
          <ConnectedUrl />
        </ThemeProvider>
      </ThemeContext.Provider>
    </Provider>
  );
  const editorElement = result.container.querySelector('#request-url .CodeMirror');
  return { store, editor: editorElement.CodeMirror, editorElement };
};

describe('Request URL query display', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    Range.prototype.getClientRects = () => [];
  });

  it.each(['http-request', 'graphql-request'])('hides queries while preserving them on base URL edits for %s', (type) => {
    const { editor, editorElement, store } = renderUrl(type);
    expect(editor.getValue()).toBe('{{host}}/users/:id');
    expect(editorElement).not.toHaveTextContent('tag=');
    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://example.com/users/123?tag=one&tag=two');

    act(() => editor.setValue('https://other.example.com/users/:id'));

    expect(editor.getValue()).toBe('https://other.example.com/users/:id');
    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://other.example.com/users/123?tag=one&tag=two');
    const request = store.getState().collections.collections[0].items[0].draft.request;
    expect(request.params.filter((p) => p.type === 'query')).toEqual(queryParams);
  });

  it('updates the preview, but not the editor, when the query parameter table changes', () => {
    const { editor, editorElement, store } = renderUrl();
    act(() => {
      store.dispatch(collectionsSlice.actions.setQueryParams({
        collectionUid: 'collection',
        itemUid: 'request',
        params: [{ uid: 'query', name: 'search', value: 'new', enabled: true }]
      }));
    });

    expect(editor.getValue()).toBe('{{host}}/users/:id');
    expect(editorElement).not.toHaveTextContent('search=');
    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://example.com/users/123?search=new');
  });

  it.each(['http-request', 'graphql-request'])('imports pasted query parameters even when the visible base URL stays the same for %s', (type) => {
    const { editor, editorElement } = renderUrl(type);

    act(() => editor.setValue('{{host}}/users/:id?tag=replaced&empty='));

    expect(editor.getValue()).toBe('{{host}}/users/:id');
    expect(editorElement).not.toHaveTextContent('tag=');
    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://example.com/users/123?tag=replaced&empty=');
    expect(screen.getByTestId('request-url-preview')).not.toHaveTextContent('tag=one');
  });

  it('keeps fragments in the editor and inserts the preserved query before them', () => {
    const { editor } = renderUrl('http-request', '#details');
    expect(editor.getValue()).toBe('{{host}}/users/:id#details');

    act(() => editor.setValue('{{host}}/users/:id#updated'));

    expect(editor.getValue()).toBe('{{host}}/users/:id#updated');
    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://example.com/users/123?tag=one&tag=two#updated');
  });

  it('hides the preview on clearing the base URL without losing query parameters', () => {
    const { editor } = renderUrl();
    act(() => editor.setValue(''));

    expect(editor.getValue()).toBe('');
    expect(screen.queryByTestId('request-url-preview')).not.toBeInTheDocument();

    act(() => editor.setValue('https://example.com/new'));

    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://example.com/new?tag=one&tag=two');
  });
});
