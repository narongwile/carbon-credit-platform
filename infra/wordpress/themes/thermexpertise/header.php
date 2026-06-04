<?php
/**
 * Header template.
 *
 * @package ThermExpertise
 */
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<a class="skip-link screen-reader-text" href="#content"><?php esc_html_e( 'Skip to content', 'thermexpertise' ); ?></a>

<header class="site-header" id="site-header">
	<div class="container site-header__inner">
		<div class="site-branding">
			<?php if ( has_custom_logo() ) : ?>
				<?php the_custom_logo(); ?>
			<?php else : ?>
				<a class="site-title" href="<?php echo esc_url( home_url( '/' ) ); ?>">
					<span class="site-title__mark">THEX</span>
					<span class="site-title__name"><?php bloginfo( 'name' ); ?></span>
				</a>
			<?php endif; ?>
		</div>

		<nav class="primary-nav" aria-label="<?php esc_attr_e( 'Primary', 'thermexpertise' ); ?>">
			<?php
			wp_nav_menu( array(
				'theme_location' => 'primary',
				'container'      => false,
				'menu_class'     => 'primary-nav__list',
				'fallback_cb'    => false,
				'depth'          => 2,
			) );
			?>
		</nav>

		<?php $phone = thex_contact( 'thex_phone' ); ?>
		<?php if ( $phone ) : ?>
			<a class="btn btn--accent header-cta" href="tel:<?php echo esc_attr( preg_replace( '/\s+/', '', $phone ) ); ?>">
				<?php echo esc_html( $phone ); ?>
			</a>
		<?php endif; ?>

		<button class="nav-toggle" aria-controls="site-header" aria-expanded="false">
			<span class="sr-only"><?php esc_html_e( 'Menu', 'thermexpertise' ); ?></span>
			<span class="nav-toggle__bar"></span>
		</button>
	</div>
</header>

<main id="content" class="site-main">
