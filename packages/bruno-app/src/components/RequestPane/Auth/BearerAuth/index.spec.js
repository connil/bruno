import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { collectionsSlice, updateAuth, updateFolderAuth } from 'providers/ReduxStore/slices/collections';
import { transformCollectionToSaveToExportAsFile, transformRequestToSaveToFilesystem } from 'utils/collections';
import { getAuthHeaders } from 'utils/codegenerator/auth';
import themes from 'themes';
import CollectionBearerAuth from 'components/CollectionSettings/Auth/BearerAuth';
import BearerAuth from './index';

jest.mock('providers/Theme', () => ({ useTheme: () => ({ storedTheme: 'light' }) }));
jest.mock('components/SensitiveFieldWarning', () => () => null);
jest.mock('components/SingleLineEditor', () => ({ value, onChange, isSecret, readOnly }) => (
  <input aria-label={isSecret ? 'Token value' : 'Prefix value'} value={value ?? ''} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
));

const renderAuth = (scope, readOnly = false) => {
  const request = { method: 'GET', url: 'https://example.com', body: { mode: 'none' }, auth: { mode: 'bearer', bearer: { token: 'secret' } } };
  const item = scope === 'folder'
    ? { uid: 'item', type: 'folder', root: { request }, items: [] }
    : { uid: 'item', name: 'Request', type: 'http-request', request };
  const store = configureStore({
    reducer: { collections: collectionsSlice.reducer },
    preloadedState: { collections: { collections: [{ uid: 'collection', name: 'Auth', root: { request }, items: [item] }] } }
  });
  const ConnectedAuth = () => {
    const collection = useSelector((state) => state.collections.collections[0]);
    const currentItem = collection.items[0];
    if (scope === 'collection') return <CollectionBearerAuth collection={collection} />;
    const currentRequest = scope === 'folder'
      ? (currentItem.draft || currentItem.root).request
      : (currentItem.draft || currentItem).request;
    const update = scope === 'folder'
      ? ({ itemUid, ...payload }) => updateFolderAuth({ ...payload, folderUid: itemUid })
      : updateAuth;
    return <BearerAuth collection={collection} item={currentItem} request={currentRequest} updateAuth={update} save={jest.fn()} readOnly={readOnly} />;
  };
  render(
    <Provider store={store}>
      <ThemeProvider theme={themes.light}>
        <ConnectedAuth />
      </ThemeProvider>
    </Provider>
  );
  return store;
};

describe('Bearer token prefix editor', () => {
  it.each(['request', 'folder', 'collection'])('edits the prefix independently of the token at %s level', (scope) => {
    const store = renderAuth(scope);
    const prefix = screen.getByRole('textbox', { name: 'Prefix value' });
    const token = screen.getByRole('textbox', { name: 'Token value' });
    expect(screen.getByText('Prefix')).toBeInTheDocument();
    expect(prefix).toHaveValue('Bearer');

    fireEvent.change(prefix, { target: { value: 'Token' } });
    expect(token).toHaveValue('secret');
    fireEvent.change(token, { target: { value: 'new-token' } });
    expect(prefix).toHaveValue('Token');

    const collection = store.getState().collections.collections[0];
    const savedAuth = scope === 'collection'
      ? collection.draft.root.request.auth
      : scope === 'folder'
        ? collection.items[0].draft.request.auth
        : transformRequestToSaveToFilesystem(collection.items[0]).request.auth;
    expect(savedAuth.bearer).toEqual({ token: 'new-token', prefix: 'Token' });
    expect(getAuthHeaders(savedAuth)).toContainEqual({ name: 'Authorization', value: 'Token new-token', enabled: true });
    if (scope === 'request') {
      const exported = transformCollectionToSaveToExportAsFile({
        ...collection,
        items: [collection.items[0].draft]
      });
      expect(exported.items[0].request.auth.bearer).toEqual(savedAuth.bearer);
    }

    fireEvent.change(prefix, { target: { value: '' } });
    expect(prefix).toHaveValue('');
    expect(token).toHaveValue('new-token');
    expect(getAuthHeaders({ mode: 'bearer', bearer: { token: token.value, prefix: prefix.value } }))
      .toContainEqual({ name: 'Authorization', value: 'Bearer new-token', enabled: true });
  });

  it('keeps the prefix read-only in a read-only request', () => {
    renderAuth('request', true);
    expect(screen.getByRole('textbox', { name: 'Prefix value' })).toHaveAttribute('readonly');
  });
});
