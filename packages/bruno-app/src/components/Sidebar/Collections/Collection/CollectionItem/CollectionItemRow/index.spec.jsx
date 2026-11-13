import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { fireEvent, render, screen } from '@testing-library/react';
import collectionsReducer from 'providers/ReduxStore/slices/collections';
import tabsReducer from 'providers/ReduxStore/slices/tabs';
import CollectionItemRow from './index';

jest.mock('platform', () => ({ os: { family: 'Windows' } }));
jest.mock('react-dnd', () => ({
  useDrag: () => [{ isDragging: false }, jest.fn(), jest.fn()],
  useDrop: () => [{ isOver: false, canDrop: false }, jest.fn()]
}));
jest.mock('react-dnd-html5-backend', () => ({ getEmptyImage: jest.fn() }));
jest.mock('components/Sidebar/SidebarAccordionContext', () => ({
  useSidebarAccordion: () => ({ dropdownContainerRef: { current: null } })
}));
jest.mock('hooks/useKeybinding', () => () => {});
jest.mock('hooks/useKeybindingDisplayText', () => () => () => '');
jest.mock('hooks/useSidebarSelectionClick', () => () => () => false);
jest.mock('utils/terminal', () => ({ openDevtoolsAndSwitchToTerminal: jest.fn() }));
jest.mock('ui/ActionIcon', () => ({ children, ...props }) => <span {...props}>{children}</span>);
jest.mock('./StyledWrapper', () => ({ children, ...props }) => <div {...props}>{children}</div>);
jest.mock('components/Sidebar/NewRequest', () => () => null);
jest.mock('components/Sidebar/NewFolder', () => () => null);
jest.mock('components/Sidebar/NewApp', () => () => null);
jest.mock('../RenameCollectionItem', () => () => null);
jest.mock('../DeleteCollectionItems', () => () => null);
jest.mock('../IgnoreCollectionItem', () => () => null);
jest.mock('../RunCollectionItem', () => () => null);
jest.mock('../GenerateCodeItem', () => () => null);
jest.mock('../CollectionItemInfo', () => () => null);
jest.mock('../CollectionItemIcon', () => () => null);
jest.mock('../../InvalidFilesBadge', () => () => null);
jest.mock('components/ResponseExample/CreateExampleModal', () => () => null);
jest.mock('ui/MenuDropdown', () => {
  const React = require('react');
  return React.forwardRef(({ items, children }, ref) => {
    const [open, setOpen] = React.useState(false);
    React.useImperativeHandle(ref, () => ({ show: () => setOpen(true) }));
    return (
      <div>
        {children}
        {open && items.map((entry) => entry.submenu
          ? <div key={entry.id}>{entry.label}{entry.submenu.map((sub) => <button key={sub.id} onClick={sub.onClick}>{sub.label}</button>)}</div>
          : <div key={entry.id}>{entry.label}</div>)}
      </div>
    );
  });
});

const renderRow = (item, fileMode = false) => {
  const store = configureStore({
    reducer: {
      collections: collectionsReducer,
      tabs: tabsReducer,
      app: (state = { clipboard: {}, isDragging: false }) => state,
      workspaces: (state = { workspaces: [], activeWorkspaceUid: null }) => state
    },
    preloadedState: {
      collections: {
        collections: [{ uid: 'collection', items: [item], fileMode, folderLevelSettingsSelectedTab: {} }],
        selectedSidebarUids: []
      }
    }
  });
  render(
    <Provider store={store}>
      <CollectionItemRow item={item} depth={0} collectionUid="collection" collectionPathname="collection" />
    </Provider>
  );
};

describe('collection item context menu', () => {
  it.each([
    { uid: 'request', name: 'Request', type: 'http-request', request: { auth: { mode: 'none' } } },
    { uid: 'folder', name: 'Folder', type: 'folder', items: [], root: { request: { auth: { mode: 'none' } } } }
  ])('does not offer auth presets on right-click for $type', (item) => {
    renderRow(item);
    fireEvent.contextMenu(screen.getByTestId('sidebar-collection-item-row'));
    expect(screen.queryByText('Apply Auth Preset')).not.toBeInTheDocument();
  });
});
