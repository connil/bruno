import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { collectionsSlice } from 'providers/ReduxStore/slices/collections';
import UrlPreview from './index';
import themes from 'themes';
import toast from 'react-hot-toast';

jest.mock('react-hot-toast', () => ({
  error: jest.fn()
}));

const theme = themes.light;
const writeText = jest.fn();
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
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
  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });

  afterAll(() => {
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    } else {
      delete navigator.clipboard;
    }
  });

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

  it('copies the current complete URL, including resolved path and query values', async () => {
    const item = {
      uid: 'request',
      request: {
        url: '{{host}}/users/:id?search={{search}}',
        params: [{ name: 'id', value: '1', type: 'path', enabled: true }]
      }
    };
    const { rerender } = render(renderPreview(item));
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith('https://example.com/users/1?search=active');
      expect(screen.getByRole('button', { name: 'Copy URL' })).toHaveAttribute('title', 'Copied');
    });

    rerender(renderPreview({
      ...item,
      draft: {
        request: {
          url: '{{host}}/users/:id?tag=new&tag=other',
          params: [{ name: 'id', value: '2', type: 'path', enabled: true }]
        }
      }
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith('https://example.com/users/2?tag=new&tag=other');
    });
  });

  it('notifies the user when copying fails', async () => {
    writeText.mockRejectedValue(new Error('Clipboard unavailable'));
    render(renderPreview({ uid: 'request', request: { url: 'https://example.com', params: [] } }));

    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to copy URL'));
    expect(screen.getByRole('button', { name: 'Copy URL' })).toHaveAttribute('title', 'Copy URL');
  });

  it('hides the preview when only preserved query parameters remain', () => {
    render(renderPreview({ uid: 'request', request: { url: '?search=active', params: [] } }));

    expect(screen.queryByTestId('request-url-preview')).not.toBeInTheDocument();
  });
});
