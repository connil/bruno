import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { collectionsSlice } from 'providers/ReduxStore/slices/collections';
import UrlPreview from './index';

const theme = { colors: { text: { muted: '#888' } } };
const collection = {
  uid: 'collection',
  runtimeVariables: { host: 'https://example.com', search: 'active', userId: '2' },
  environments: [],
  items: []
};

const renderPreview = (item) => (
  <ThemeProvider theme={theme}>
    <UrlPreview item={item} collection={collection} />
  </ThemeProvider>
);

describe('URL preview', () => {
  it.each(['http-request', 'graphql-request'])('tracks path and query parameter edits for %s', (type) => {
    const pathParam = { uid: 'path-id', name: 'id', value: '1', type: 'path', enabled: true };
    const item = {
      uid: 'request',
      type,
      request: {
        url: '{{host}}/users/:id?search={{search}}',
        params: [pathParam, { uid: 'query-search', name: 'search', value: '{{search}}', type: 'query', enabled: true }]
      }
    };
    const store = configureStore({
      reducer: { collections: collectionsSlice.reducer },
      preloadedState: { collections: { collections: [{ ...collection, items: [item] }] } }
    });
    const ConnectedPreview = () => {
      const currentCollection = useSelector((state) => state.collections.collections[0]);
      return <UrlPreview collection={currentCollection} item={currentCollection.items[0]} />;
    };
    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ConnectedPreview />
        </ThemeProvider>
      </Provider>
    );

    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://example.com/users/1?search=active');

    act(() => {
      store.dispatch(collectionsSlice.actions.updatePathParam({
        collectionUid: collection.uid,
        itemUid: item.uid,
        pathParam: { ...pathParam, value: '{{userId}}' }
      }));
    });

    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://example.com/users/2?search=active');
    expect(store.getState().collections.collections[0].items[0].draft.request.url).toBe(item.request.url);

    act(() => {
      store.dispatch(collectionsSlice.actions.setQueryParams({
        collectionUid: collection.uid,
        itemUid: item.uid,
        params: [
          { uid: 'tag-1', name: 'tag', value: 'new', enabled: true },
          { uid: 'tag-2', name: 'tag', value: 'other', enabled: true },
          { uid: 'hidden', name: 'hidden', value: 'disabled', enabled: false }
        ]
      }));
    });
    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://example.com/users/2?tag=new&tag=other');

    act(() => {
      store.dispatch(collectionsSlice.actions.setQueryParams({
        collectionUid: collection.uid,
        itemUid: item.uid,
        params: [{ uid: 'tag-1', name: 'tag', value: 'new', enabled: false }]
      }));
    });
    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://example.com/users/2');
    expect(item.request.url).toBe('{{host}}/users/:id?search={{search}}');
  });

  it('uses the enabled path value and preserves raw characters and fragments', () => {
    const item = {
      uid: 'request',
      request: {
        url: 'https://example.com/users/:id/:missing#details',
        params: [
          { name: 'id', value: 'unused', type: 'path', enabled: false },
          { name: 'id', value: 'a/b c', type: 'path', enabled: true }
        ]
      }
    };
    render(renderPreview(item));

    expect(screen.getByTestId('request-url-preview')).toHaveTextContent('https://example.com/users/a/b c/:missing#details');
  });

  it('hides the preview when the draft URL is cleared', () => {
    render(renderPreview({
      uid: 'request',
      request: { url: 'https://example.com', params: [] },
      draft: { request: { url: '', params: [] } }
    }));

    expect(screen.queryByTestId('request-url-preview')).not.toBeInTheDocument();
  });
});
