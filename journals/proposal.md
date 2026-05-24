# May.24 2026
journals里面是人类写的input，AI不要动。
docs里面是AI写的同行经验，可能有幻觉。可能误读人类指令。参考一下就行。
以../里面的JustReadPapers为蓝本，参考BackgroundRadio中关于只读Onedrive媒体文件夹管理的策略，和RealHome里面关于缓存的策略，做一个JustReadBooks的类似项目
功能很简单：网络小说（txt）和图书（pdf，perhaps epub（not prioritized））
也许可以支持用户上传，但是主要是在onedrive端管理整理
有目录，子文件夹
所有依赖库，PWA需要离线缓存，然后文件可以手动缓存，可以设置缓存大小。可以管理缓存增加删除。目的是飞机上离线可以看
网络小说支持分章：markdown章节（#,##,###,......），几个你推荐的正则，以及用户输入正则
看一下BackgroundRadio里面的白金和黑金配色，日夜模式。以及跟随系统。
网络小说要小心gb2312编码。本地统一utf。但是不用帮云端转码。但是本地上传的可以转