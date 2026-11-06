import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  Bold,
  Code2,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { Note, Reminder } from '../types'
import { addImage, hydrateHtml } from '../db/assets'
import { NOTE_COLORS } from '../db/notes'
import { fmtRelative } from '../lib/schedule'

const AssetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-asset': {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-asset'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs['data-asset'] ? { 'data-asset': attrs['data-asset'] } : {},
      },
    }
  },
})

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active ? 'bg-[#2f6b4f]/12 text-[#2f6b4f]' : 'text-[#6b7168] hover:bg-black/5'
      }`}
    >
      {children}
    </button>
  )
}

interface Props {
  note: Note
  onPatch: (patch: { title?: string; contentHtml?: string; color?: string }) => void
  onDelete: () => void
  onBack?: () => void
  showBack?: boolean
  reminder?: Reminder | null
  onOpenReminder: () => void
}

export default function EditorPane({
  note,
  onPatch,
  onDelete,
  onBack,
  showBack,
  reminder,
  onOpenReminder,
}: Props) {
  const [title, setTitle] = useState(note.title)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const hydratedFor = useRef<string | null>(null)
  const patchRef = useRef(onPatch)
  patchRef.current = onPatch
  const fileInput = useRef<HTMLInputElement>(null)
  const noteId = note.id

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      AssetImage.configure({ allowBase64: false }),
      Placeholder.configure({ placeholder: '写点什么… 直接粘贴截图就能插图' }),
    ],
    content: '',
    editorProps: {
      attributes: { class: 'focus:outline-none' },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        )
        if (!files.length) return false
        event.preventDefault()
        files.forEach((f) => void insertImage(f))
        return true
      },
      handleDrop(_view, event) {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        )
        if (!files.length) return false
        event.preventDefault()
        files.forEach((f) => void insertImage(f))
        return true
      },
    },
    onUpdate({ editor: ed }) {
      window.clearTimeout(timer.current)
      const html = ed.getHTML()
      timer.current = window.setTimeout(() => patchRef.current({ contentHtml: html }), 400)
    },
  })

  async function insertImage(file: File) {
    if (!editor) return
    setBusy(true)
    try {
      const { assetId, url } = await addImage(noteId, file)
      editor
        .chain()
        .focus()
        .insertContent({ type: 'image', attrs: { src: url, 'data-asset': assetId } })
        .run()
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setTitle(note.title)
  }, [note.id, note.title])

  useEffect(() => {
    if (!editor) return
    if (hydratedFor.current === note.id) return
    hydratedFor.current = note.id
    let cancelled = false
    void hydrateHtml(note.contentHtml).then((html) => {
      if (cancelled || !editor) return
      editor.commands.setContent(html || '<p></p>', { emitUpdate: false })
      if (!html) editor.commands.focus('end')
    })
    return () => {
      cancelled = true
    }
  }, [editor, note.id, note.contentHtml])

  if (!editor) return null

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-[#eeeeea] px-4 py-2.5">
        {showBack && (
          <button
            onClick={onBack}
            className="mr-1 rounded-md px-1.5 py-1 text-[13px] text-[#6b7168] hover:bg-black/5 md:hidden"
          >
            返回
          </button>
        )}
        <div className="flex items-center gap-1">
          {NOTE_COLORS.map((c) => (
            <button
              key={c.key}
              title={c.label}
              onClick={() => onPatch({ color: c.key })}
              style={{ background: c.swatch }}
              className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                note.color === c.key ? 'border-[#2f6b4f] ring-1 ring-[#2f6b4f]' : 'border-[#dcdcd6]'
              }`}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-[12px] text-[#9aa097]">
          <button
            onClick={onOpenReminder}
            title="设置提醒"
            className={`flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
              reminder?.nextAt
                ? 'bg-[#2f6b4f]/10 text-[#2f6b4f]'
                : 'text-[#6b7168] hover:bg-black/5'
            }`}
          >
            <Bell size={14} />
            <span className="hidden text-[11.5px] sm:inline">
              {reminder?.nextAt ? fmtRelative(reminder.nextAt) : '提醒'}
            </span>
          </button>
          <span className="hidden sm:inline">{busy ? '图片处理中…' : '已自动保存'}</span>
          <button
            onClick={onDelete}
            title="删除便签"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#6b7168] transition-colors hover:bg-[#fdecec] hover:text-[#c0392b]"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-[#f4f4f0] px-3 py-1.5">
        <ToolButton title="撤销" onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={15} />
        </ToolButton>
        <ToolButton title="重做" onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={15} />
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-[#e8e8e2]" />
        <ToolButton
          title="加粗"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={15} />
        </ToolButton>
        <ToolButton
          title="斜体"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={15} />
        </ToolButton>
        <ToolButton
          title="删除线"
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={15} />
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-[#e8e8e2]" />
        <ToolButton
          title="无序列表"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={15} />
        </ToolButton>
        <ToolButton
          title="有序列表"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={15} />
        </ToolButton>
        <ToolButton
          title="引用"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={15} />
        </ToolButton>
        <ToolButton
          title="代码块"
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code2 size={15} />
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-[#e8e8e2]" />
        <ToolButton title="插入图片" onClick={() => fileInput.current?.click()}>
          <ImagePlus size={15} />
        </ToolButton>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            files.forEach((f) => void insertImage(f))
            e.target.value = ''
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-6 py-6 md:px-10">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              onPatch({ title: e.target.value })
            }}
            placeholder="标题（可留空，第一行自动当标题）"
            className="mb-3 w-full border-none bg-transparent text-[22px] font-medium leading-snug text-[#1f2320] outline-none placeholder:text-[#c3c7bf]"
          />
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
