<?php
/**
 * Template for the "Products" page (slug: products).
 *
 * @package thermexpertise
 */

$thex     = thex_company();
$products = thex_products();
get_header();
?>

<section class="page-hero">
	<div class="container">
		<div class="breadcrumb"><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Home', 'thermexpertise' ); ?></a> &nbsp;/&nbsp; <?php esc_html_e( 'Products', 'thermexpertise' ); ?></div>
		<h1><?php esc_html_e( 'We Offer Our Products', 'thermexpertise' ); ?></h1>
		<p><?php esc_html_e( 'Product of THEX — engineering instruments designed and built by Therm Expertise.', 'thermexpertise' ); ?></p>
	</div>
</section>

<section class="section">
	<div class="container">
		<div class="products">
			<?php foreach ( $products as $p ) : ?>
				<article class="product-card">
					<div class="product-card__media">
						<?php echo thex_icon( 'box' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
						<span class="model" style="position:absolute;bottom:14px;left:18px"><?php echo esc_html( $p['model'] ); ?></span>
					</div>
					<div class="product-card__body">
						<?php if ( ! empty( $p['soon'] ) ) : ?>
							<span class="badge badge--soon"><?php esc_html_e( 'Coming soon', 'thermexpertise' ); ?></span>
						<?php else : ?>
							<span class="badge"><?php esc_html_e( 'Available', 'thermexpertise' ); ?></span>
						<?php endif; ?>
						<h3><?php echo esc_html( $p['name'] ); ?></h3>
						<p><?php echo esc_html( $p['desc'] ); ?></p>
						<a class="btn btn--outline" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Contact for inquiry', 'thermexpertise' ); ?></a>
					</div>
				</article>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<?php
get_footer();
